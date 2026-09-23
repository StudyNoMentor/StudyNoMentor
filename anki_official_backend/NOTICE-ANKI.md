# Anki official engine

This service intentionally depends on the upstream **Anki 26.09.2** Python package
instead of reimplementing Anki scheduling.

- Upstream project: https://github.com/ankitects/anki
- Pinned version: 26.09.2
- Upstream license: GNU AGPL-3.0-or-later
- Upstream source for the pinned release:
  https://github.com/ankitects/anki/tree/26.09.2

The StudyNoMentor web client is only a frontend to this service. Scheduler,
FSRS, queueing, card state transitions, Anki search, package import/export and
collection storage are delegated to the upstream Anki package.

Qt/PyQt desktop GUI code and traditional Python/Qt add-ons are **not** executed
by this headless service. Those require an actual Anki Desktop process.
