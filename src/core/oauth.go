package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"dogfood/src/store"
)

// Sign-in with an external identity provider (OAuth 2.0 authorization code
// flow, with PKCE where the provider supports it). Every provider is off
// unless the operator sets its client id and secret, so a default instance
// makes no outbound request and stays fully offline, as the brief requires.
//
// Accounts are matched by the provider's stable user id first, then by a
// *verified* email address. Password sign-up refuses existing emails because
// nothing proves the person owns the address; a provider-verified address
// does, so it may link to an existing account, including one imported for a
// judge or team member who has no password yet.

type OAuthProvider struct {
	ID, Name     string
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	UserURL      string
	EmailsURL    string // GitHub only: the user's addresses and their verification state
	Scopes       []string
	PKCE         bool
	BasicAuth    bool   // send client credentials as HTTP Basic (X requires it)
	Extra        string // extra authorize parameters, already encoded
}

// Identity is what a provider vouches for about the person signing in.
type Identity struct {
	Provider      string
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// OAuthProviders returns the providers whose credentials are set, in a fixed
// order. getenv is os.Getenv in production.
func OAuthProviders(getenv func(string) string) []*OAuthProvider {
	all := []*OAuthProvider{
		{ID: "github", Name: "GitHub", AuthURL: "https://github.com/login/oauth/authorize",
			TokenURL: "https://github.com/login/oauth/access_token", UserURL: "https://api.github.com/user",
			EmailsURL: "https://api.github.com/user/emails", Scopes: []string{"read:user", "user:email"}, PKCE: true},
		{ID: "google", Name: "Google", AuthURL: "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL: "https://oauth2.googleapis.com/token", UserURL: "https://openidconnect.googleapis.com/v1/userinfo",
			Scopes: []string{"openid", "email", "profile"}, PKCE: true, Extra: "prompt=select_account"},
		{ID: "linkedin", Name: "LinkedIn", AuthURL: "https://www.linkedin.com/oauth/v2/authorization",
			TokenURL: "https://www.linkedin.com/oauth/v2/accessToken", UserURL: "https://api.linkedin.com/v2/userinfo",
			Scopes: []string{"openid", "profile", "email"}},
		{ID: "x", Name: "X", AuthURL: "https://x.com/i/oauth2/authorize",
			TokenURL: "https://api.x.com/2/oauth2/token", UserURL: "https://api.x.com/2/users/me?user.fields=confirmed_email",
			Scopes: []string{"users.read", "tweet.read", "users.email"}, PKCE: true, BasicAuth: true},
	}
	var out []*OAuthProvider
	for _, p := range all {
		key := "DOGFOOD_OAUTH_" + strings.ToUpper(p.ID)
		p.ClientID, p.ClientSecret = getenv(key+"_CLIENT_ID"), getenv(key+"_CLIENT_SECRET")
		if p.ClientID != "" && p.ClientSecret != "" {
			out = append(out, p)
		}
	}
	return out
}

// AuthCodeURL is where the browser is sent to sign in.
func (p *OAuthProvider) AuthCodeURL(state, challenge, redirect string) string {
	q := url.Values{"response_type": {"code"}, "client_id": {p.ClientID}, "redirect_uri": {redirect},
		"scope": {strings.Join(p.Scopes, " ")}, "state": {state}}
	if p.PKCE {
		q.Set("code_challenge", challenge)
		q.Set("code_challenge_method", "S256")
	}
	u := p.AuthURL + "?" + q.Encode()
	if p.Extra != "" {
		u += "&" + p.Extra
	}
	return u
}

// PKCEChallenge is the S256 challenge for a verifier (RFC 7636).
func PKCEChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

var oauthClient = &http.Client{Timeout: 10 * time.Second}

// Exchange trades the authorization code for an access token and asks the
// provider who signed in.
func (p *OAuthProvider) Exchange(ctx context.Context, code, verifier, redirect string) (*Identity, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirect}}
	if p.PKCE {
		form.Set("code_verifier", verifier)
	}
	form.Set("client_id", p.ClientID)
	if !p.BasicAuth {
		form.Set("client_secret", p.ClientSecret)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, p.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if p.BasicAuth {
		req.SetBasicAuth(url.QueryEscape(p.ClientID), url.QueryEscape(p.ClientSecret))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := doJSON(req, &tok); err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("token exchange: %s %s", tok.Error, tok.Description)
	}
	get := func(u string, v any) error {
		r, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		r.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		r.Header.Set("Accept", "application/json")
		r.Header.Set("User-Agent", "dogfood-judge") // GitHub rejects requests without one
		return doJSON(r, v)
	}
	id := &Identity{Provider: p.ID}
	switch p.ID {
	case "github":
		var u struct {
			ID    int64  `json:"id"`
			Login string `json:"login"`
			Name  string `json:"name"`
		}
		if err := get(p.UserURL, &u); err != nil {
			return nil, err
		}
		var emails []struct {
			Email    string `json:"email"`
			Primary  bool   `json:"primary"`
			Verified bool   `json:"verified"`
		}
		if err := get(p.EmailsURL, &emails); err != nil {
			return nil, err
		}
		for _, e := range emails {
			if e.Primary && e.Verified {
				id.Email, id.EmailVerified = e.Email, true
			}
		}
		id.Subject, id.Name = fmt.Sprint(u.ID), firstNonEmpty(u.Name, u.Login)
	case "x":
		var u struct {
			Data struct {
				ID             string `json:"id"`
				Name           string `json:"name"`
				Username       string `json:"username"`
				ConfirmedEmail string `json:"confirmed_email"`
			} `json:"data"`
		}
		if err := get(p.UserURL, &u); err != nil {
			return nil, err
		}
		d := u.Data
		id.Subject, id.Name = d.ID, firstNonEmpty(d.Name, d.Username)
		id.Email, id.EmailVerified = d.ConfirmedEmail, d.ConfirmedEmail != ""
	default: // OpenID Connect userinfo: Google, LinkedIn
		var u struct {
			Sub      string          `json:"sub"`
			Email    string          `json:"email"`
			Verified json.RawMessage `json:"email_verified"`
			Name     string          `json:"name"`
		}
		if err := get(p.UserURL, &u); err != nil {
			return nil, err
		}
		// Some providers send the flag as a string.
		v := strings.Trim(string(u.Verified), `"`)
		id.Subject, id.Email, id.EmailVerified, id.Name = u.Sub, u.Email, v == "true", u.Name
	}
	if id.Subject == "" {
		return nil, errors.New("provider returned no user id")
	}
	return id, nil
}

func doJSON(req *http.Request, v any) error {
	res, err := oauthClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 && res.StatusCode != http.StatusBadRequest && res.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("%s returned %d", req.URL.Host, res.StatusCode)
	}
	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("%s returned %d with a body that is not JSON", req.URL.Host, res.StatusCode)
	}
	return nil
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if strings.TrimSpace(x) != "" {
			return strings.TrimSpace(x)
		}
	}
	return ""
}

// SocialLogin signs in the person a provider vouched for: the account already
// linked to this provider identity, else the account with the same verified
// email (which is then linked), else a new account. Returns a session token.
func (s *Service) SocialLogin(ctx context.Context, a Actor, id *Identity) (string, *User, error) {
	var u User
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := s.nowS()
		err := tx.QueryRowContext(ctx, `SELECT u.id, u.email, u.name, u.is_admin FROM user_identities i
			JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?`, id.Provider, id.Subject).
			Scan(&u.ID, &u.Email, &u.Name, &u.IsAdmin)
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE user_identities SET last_used = ? WHERE provider = ? AND subject = ?`,
				now, id.Provider, id.Subject)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if !id.EmailVerified || id.Email == "" {
			return errInvalid("unverified_email", "%s did not share a verified email address, so the account can't be matched; verify your email there or sign in another way", providerName(id.Provider))
		}
		email, err := normEmail(id.Email)
		if err != nil {
			return err
		}
		action := "user.identity_link"
		err = tx.QueryRowContext(ctx, `SELECT id, email, name, is_admin FROM users WHERE email = ?`, email).
			Scan(&u.ID, &u.Email, &u.Name, &u.IsAdmin)
		if errors.Is(err, sql.ErrNoRows) {
			action = "user.signup"
			name := firstNonEmpty(id.Name, strings.SplitN(email, "@", 2)[0])
			if len([]rune(name)) > 80 {
				name = string([]rune(name)[:80])
			}
			u = User{ID: store.NewID("usr"), Email: email, Name: name}
			_, err = tx.ExecContext(ctx, `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`,
				u.ID, email, name, now)
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_used)
			VALUES (?, ?, ?, ?, ?, ?)`, id.Provider, id.Subject, u.ID, email, now, now); err != nil {
			return err
		}
		return s.audit(ctx, tx, Actor{User: &u, IP: a.IP, Source: a.Source}, "", action, u.ID,
			map[string]any{"provider": id.Provider})
	})
	if err != nil {
		return "", nil, err
	}
	u.CanLogin = true
	token, err := s.issueCredential(ctx, u.ID, "session", "", s.now().Add(SessionTTL))
	return token, &u, err
}

var providerNames = map[string]string{"github": "GitHub", "google": "Google", "linkedin": "LinkedIn", "x": "X"}

func providerName(id string) string {
	if n, ok := providerNames[id]; ok {
		return n
	}
	return id
}

// Seal and Open protect small values the server hands to the browser and
// expects back unchanged (the OAuth state cookie), with an HMAC under the
// instance secret and an expiry.
func (s *Service) Seal(purpose string, v any, ttl time.Duration) string {
	body, _ := json.Marshal(struct {
		V   any   `json:"v"`
		Exp int64 `json:"exp"`
	}{v, s.now().Add(ttl).Unix()})
	enc := base64.RawURLEncoding.EncodeToString(body)
	return enc + "." + s.seal(purpose, enc)
}

func (s *Service) Open(purpose, sealed string, v any) error {
	enc, mac, ok := strings.Cut(sealed, ".")
	if !ok || !hmac.Equal([]byte(mac), []byte(s.seal(purpose, enc))) {
		return errors.New("tampered or foreign value")
	}
	body, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return err
	}
	var w struct {
		V   json.RawMessage `json:"v"`
		Exp int64           `json:"exp"`
	}
	if err := json.Unmarshal(body, &w); err != nil {
		return err
	}
	if s.now().Unix() > w.Exp {
		return errors.New("expired")
	}
	return json.Unmarshal(w.V, v)
}

func (s *Service) seal(purpose, enc string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("seal:" + purpose + ":" + enc))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
