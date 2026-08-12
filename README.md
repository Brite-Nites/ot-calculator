# Overtime & Wage Calculator

Public hosting for a single self-contained page used by Brite Nites field
managers. What a field worker costs at any rate and any number of hours,
including California and Colorado daily-overtime rules.

**Live:** https://brite-nites.github.io/ot-calculator/

## This repo is a deploy target, not the source of record

`index.html` is a copy. The source, the overtime engine, its test harness and
the scope document live in the private internal operations repo. Edit there,
then copy the file here.

Nothing in this repo contains employee data, pay records or financials — that
is why it can be public. **Keep it that way:** do not add the test harness,
which validates against real payroll.

## What the page does and does not do

Wages and overtime only. Not a budget tool, headcount planner, or
housing/per-diem model. Rate constants are current as of January 2026 and the
page cannot track law changes — the limitations are stated on the page itself
and should be read before quoting any number.
