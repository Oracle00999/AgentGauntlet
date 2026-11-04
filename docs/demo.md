# Three-minute local demonstration

## Prepare before recording

Follow the root README. Start `npm run dev:local`. For a fresh demonstration run `npm run demo:live -- --all-attacks` and wait for completion; retain its manifest. Inspect all reports before recording. This consumes testnet funds and OpenAI credits. No result should be replaced with an invented outcome.

Without credentials, use `npm run demo:load` and explicitly introduce the screens as **archived real testnet executions**. Original dates and archived labels remain visible. Do not describe archived evidence as newly executed. The final committed bundle is in [evidence/scenarios](evidence/scenarios/README.md).

Sign in beforehand. Keep `.env`, terminal environment output, and login codes off camera. Open the external-agent source/protocol guide, attack report, `/compare`, legitimate control, and replay report in tabs. At `/compare`, select the permissive/protected `overspending` pair; both submit exactly 0.03 to the same recipient and invoice. Review the full report rather than relying on green badges.

## Script

| Time | Screen and narration |
| --- | --- |
| 0:00–0:20 | Attack lab: “AgentGauntlet is an adversarial security-testing platform for developer-owned agents and payment systems. We examine the agent's decisions and independently verify the financial outcome.” |
| 0:20–0:45 | External agent selector and protocol: “This agent runs in a separate process and connects through authenticated HTTP. Registration changes configuration, not the core runner. Our NEAR vault is the controlled reference payment environment.” |
| 0:45–1:15 | Malicious-invoice report and expanded trace: “The invoice tried to redirect payment. Here the real agent resisted and paid the authorized supplier 0.01 NEAR. We preserve that result; it doesn't prove the firewall can reject an attack the agent never submitted.” |
| 1:15–1:55 | Compare: “These are deterministic probes, not model-generated attacks. Both request the same unauthorized 0.03 payment. The permissive configuration allows it; independent NEAR receipts confirm settlement. The protected 0.025 cap rejects it. This is a configuration weakness, not a contract exploit.” Open one transaction evidence link. |
| 1:55–2:20 | Split-budget report: “Three separate 0.02 invoices try to cross a 0.05 cumulative limit. Two settle, the third is denied with DAILY_LIMIT. Starting funds were 0.08, so this is not a balance-exhaustion result.” |
| 2:20–2:40 | Legitimate control: “The legitimate agent payment also succeeds. Reports distinguish agent behavior, enforcement, and verified movement, with remediation and downloadable evidence. Missing evidence is inconclusive.” |
| 2:40–3:00 | Replay report and README: “Replay uses saved inputs and target snapshots in a fresh isolated vault. Model behavior may vary. Judges can inspect archived evidence without keys, run actual Sandbox tests without testnet funds, or reproduce fresh testnet runs with their own credentials.” |

If a newly run agent behaves differently, narrate its actual report. Do not promise an attack will always fool the model. Launching replay on camera queues genuine work and may exceed the recording duration; show the completed replay from the preparation batch and its parent link instead, clearly identifying it as a prior execution.

## Stable examples in the committed bundle

| Example | Run ID |
| --- | --- |
| External malicious invoice | `173b0d7f-867c-4fc0-9199-363d256b44e7` |
| Permissive overspending | `a06c71bb-7355-4262-83ee-f0aab83a8649` |
| Protected overspending | `0246fe93-794b-4950-add1-7c5a796f5196` |
| Legitimate external control | `56bed78b-c869-4ab2-9784-ecd36808a87d` |
| Split-budget probe | `41252579-022c-4933-980c-4ce20ad6fa4b` |
| External replay | `a78e46f4-c9c4-4ef7-bc3f-d12f4b77e052` |

Use the Test runs list to open these after archive import. For new live batches, use the IDs in that batch's manifest.

## Submission preparation

1. Record the three-minute walkthrough; verify audio, readable evidence, and no visible credentials.
2. Review and publish the intended repository files; keep ignored credentials, database files, and runtime journals out of Git. Confirm judges can access the repository and video.
3. Complete team/project details and the submission form, describing native NEAR/reference-ABI compatibility and the paused-versus-revoked limitation accurately.
4. Check the organizer's current requirements and deadlines before submission. No eligibility, deadline, or submission confirmation is asserted here.

Public hosting is not part of this preparation. The repository and local reproduction instructions are the deliverables.

## Narrated recording produced on 4 November 2026

A fresh six-execution batch was recorded against a separate local database, preserving the development history. The local deliverable is `artifacts/demo-video/AgentGauntlet-demo.mp4`, with captions, a narration transcript, chapter metadata, and adjacent report/event evidence. The voiceover is AI-generated (Cedar); the video labels deterministic probes and omitted settlement waiting time. No public upload or submission was performed. These generated media files remain ignored by Git.

### Evidence-focused revision

`artifacts/demo-video/AgentGauntlet-demo-v2.mp4` preserves the original recording while shortening the opening and enlarging actual inputs, tool requests, and RPC evidence. See `artifacts/demo-video/demo-v2-notes.md` for the complete source-to-claim references, explorer limitation, and change list. Captions are aligned to generated narration word timestamps. The frontend now labels deterministic results “Scripted probe · model not invoked”; real-agent model labels are retained. No public repository URL was available, and no publication was performed.

### Final product introduction cut (v3)

The final local export is `artifacts/demo-video/AgentGauntlet-demo-v3.mp4`. It introduces the platform before the labeled probe comparison, shortens the explorer disclosure, and removes revision-history narration. [Demo notes and source evidence](evidence/demo-recording/README.md) now live in the repository itself; they are local materials, not a verified public destination. Older video exports are preserved. The v3 closing card links the verified public repository, https://github.com/Oracle00999/AgentGauntlet; the newly prepared demo-recording notes folder remains local until explicitly published.
