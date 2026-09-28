package core

import "context"

// Stats are instance-wide totals over public events only, for the landing
// page. They are counts, never scores or names, so they reveal nothing an
// anonymous visitor could not already tally from the public gallery except
// how much judging work has been done.
type Stats struct {
	Events      int `json:"events"`
	Projects    int `json:"projects"`
	Judges      int `json:"judges"`
	Reviews     int `json:"reviews"`
	Comparisons int `json:"comparisons"`
	AuditLength int `json:"audit_entries"`
}

func (s *Service) Stats(ctx context.Context) (*Stats, error) {
	out := &Stats{}
	pub := `event_id IN (SELECT id FROM events WHERE is_public = 1)`
	q := []struct {
		sql  string
		dest *int
	}{
		{`SELECT count(*) FROM events WHERE is_public = 1`, &out.Events},
		{`SELECT count(*) FROM projects WHERE status = 'submitted' AND duplicate_of IS NULL AND disqualified_reason IS NULL AND ` + pub, &out.Projects},
		{`SELECT count(DISTINCT user_id) FROM event_roles WHERE role = 'judge' AND ` + pub, &out.Judges},
		{`SELECT count(*) FROM reviews WHERE ` + pub, &out.Reviews},
		{`SELECT count(*) FROM comparisons WHERE ` + pub, &out.Comparisons},
		{`SELECT count(*) FROM audit_log WHERE ` + pub, &out.AuditLength},
	}
	for _, x := range q {
		if err := s.DB.QueryRowContext(ctx, x.sql).Scan(x.dest); err != nil {
			return nil, err
		}
	}
	return out, nil
}
