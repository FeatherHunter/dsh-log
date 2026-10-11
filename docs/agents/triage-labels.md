# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Wayfinder labels

`/wayfinder` uses five additional labels alongside the triage roles above. Together they are the 10 core labels required in this repo's issue tracker (triage five + wayfinder five). Keep all ten; do not create only a subset.

| Label in our tracker      | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| `wayfinder:map`         | The map issue holding Notes / Decisions-so-far / Fog |
| `wayfinder:research`    | AFK research ticket (fact a decision waits on)       |
| `wayfinder:prototype`   | Prototype ticket (cheap artifact to react to)        |
| `wayfinder:grilling`    | Grilling ticket (conversation to sharpen the ask)    |
| `wayfinder:task`        | Task ticket (manual work unblocking a decision)      |

Labeling discipline: follow each skill's own rules strictly. Do not impose any additional mandatory labels beyond what the skills require.
