---
status: accepted
date: 2026-09-08
---

# 4. In-Player Controls via Shadow DOM Injection

We decided to inject the dubbing controls directly into the YouTube player control bar (`.ytp-right-controls`) isolated inside a Shadow DOM mount, accompanied by an Options settings page, rather than relying solely on a browser popup. In-player controls provide a seamless native streaming experience (similar to Netflix audio selection) directly on the screen, while Shadow DOM prevents YouTube's extensive global stylesheets from interfering with the extension UI and vice-versa.
