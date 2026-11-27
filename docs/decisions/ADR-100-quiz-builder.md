# ADR-100 — Quiz Builder

Each QUIZ lesson can have one quiz. A quiz contains 1–20 ordered questions with 2–6 plain-text options each. Exactly one zero-based option index identifies the correct answer. Draft saves replace the ordered questions atomically under the course lock. Changing the lesson type releases its quiz configuration.

Publishing requires quiz configuration and locks the questions and answer key. Learner reads apply the existing published-course assignment predicate and project only prompts and options. The server scores one point per correct answer and stores selections and totals against the learner's active organization membership. Each explicit retry can produce another score. Repeating the same submission key with the same selections returns the saved result.

The portal displays the learner's score and most recent attempt. Course completion and reporting follow in the learning progress and reporting epics.
