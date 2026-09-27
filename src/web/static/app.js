// Progressive enhancement only: every page works without JavaScript.
(function () {
  // Live organizer dashboard: poll the progress endpoint and update in place.
  var live = document.querySelector("[data-progress-url]");
  if (live) {
    var url = live.getAttribute("data-progress-url");
    var set = function (key, value) {
      document.querySelectorAll('[data-live="' + key + '"]').forEach(function (el) { el.textContent = value; });
    };
    var tick = function () {
      fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (!p) return;
          set("done", p.done);
          set("assignments", p.assignments);
          set("percent", Math.round(p.percent) + "%");
          set("fully", p.fully_reviewed);
          set("projects", p.projects);
          set("comparisons", p.comparisons);
          set("votes", p.votes);
          set("updated", new Date(p.updated_at).toLocaleTimeString());
          var bar = document.querySelector("[data-live-bar]");
          if (bar) bar.style.width = Math.round(p.percent) + "%";
          (p.judges || []).forEach(function (j) {
            var row = document.querySelector('[data-judge="' + j.id + '"]');
            if (!row) return;
            row.querySelector("[data-j-done]").textContent = j.done + " / " + j.assigned;
            var jb = row.querySelector("[data-j-bar]");
            if (jb) jb.style.width = (j.assigned ? Math.round(100 * j.done / j.assigned) : 0) + "%";
          });
        })
        .catch(function () {});
    };
    setInterval(tick, 5000);
  }

  // Copy buttons.
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.getAttribute("data-copy"));
      if (!el) return;
      navigator.clipboard.writeText(el.value || el.textContent).then(function () {
        var old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = old; }, 1500);
      });
    });
  });

  // Keyboard shortcuts on the pairwise page: A / B / T.
  var pw = document.querySelector("[data-pairwise]");
  if (pw) {
    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
      var k = e.key.toLowerCase();
      var map = { a: "a", b: "b", t: "tie" };
      if (map[k]) {
        var btn = pw.querySelector('button[value="' + map[k] + '"]');
        if (btn) btn.click();
      }
    });
  }

  document.querySelectorAll("[data-print]").forEach(function (b) {
    b.addEventListener("click", function () { window.print(); });
  });

  // Confirm destructive or irreversible actions.
  document.querySelectorAll("form[data-confirm]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      if (!confirm(f.getAttribute("data-confirm"))) e.preventDefault();
    });
  });
})();
