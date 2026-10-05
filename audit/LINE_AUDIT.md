# Line-by-line audit ledger — every file of the app, read whole, one at a time
# Status at m609-001 (Oct 5 2026): 78 of 122 files DONE — 36,512 of 64,113 lines (26,174 of 47,196 code lines).
# Read a file whole with: python3 audit/show.py <file> <from> <to> [width]  (prints code lines, comments set aside;
# read the prompt strings too — they are what a helper is told). Mark a file "DONE (Mxxx)" here when read whole and fixed.
# The order to take the rest: audit/README.md, "What is left".
# file | lines | code lines | status
js/ui/chat.js | 7288 | 5304 | DONE (M574-M577)
js/canon/grounding.js | 6365 | 4209 | todo
js/agents/housekeeper.js | 3408 | 2716 | DONE (M601-M603)
js/ui/settings.js | 3197 | 2701 | todo
js/ui/drawer.js | 3130 | 2625 | todo
js/engine/apply.js | 2266 | 1661 | DONE (M578)
js/ui/housekeeper.js | 1584 | 1338 | todo
js/agents/referee.js | 1651 | 1218 | DONE (M600)
js/engine/duels.js | 1501 | 1200 | DONE (M584, M593)
index.html | 1241 | 1180 | todo
js/agents/memory.js | 1652 | 1136 | DONE (M595)
js/assemble/stack.js | 1677 | 1046 | DONE (M609)
js/engine/state.js | 1490 | 1033 | DONE (M570, M578)
serve.py | 1050 | 976 | todo
js/agents/auditor.js | 1180 | 854 | DONE (M598, M599)
js/engine/people.js | 1235 | 829 | DONE (M579)
js/store.js | 1172 | 797 | todo
js/canon/bridge.js | 983 | 733 | todo
js/engine/world.js | 979 | 662 | DONE (M579)
js/providers/openai.js | 782 | 577 | todo
js/agents/world.js | 652 | 503 | DONE (M597, M598)
js/agents/extractor.js | 662 | 441 | DONE (M588, M594)
js/providers/effort.js | 676 | 425 | todo
js/agents/director.js | 472 | 355 | DONE (M606)
js/sync.js | 541 | 354 | todo
js/regex-styles.js | 366 | 350 | todo
js/ui/receiptview.js | 392 | 335 | todo
js/assemble/modules.js | 488 | 316 | DONE (M609)
js/providers/anthropic.js | 417 | 308 | todo
js/agents/continuity.js | 416 | 298 | DONE (M606)
js/agents/founder.js | 376 | 288 | DONE (M606)
js/agents/rebuild.js | 421 | 283 | DONE (M607)
js/regex.js | 340 | 251 | todo
js/import/lorebook.js | 360 | 250 | todo
js/ui/pageshape.js | 373 | 249 | todo
js/agents/scribe.js | 354 | 239 | DONE (M607)
js/app.js | 358 | 238 | todo
js/sync-worker.js | 372 | 238 | todo
js/ui/headergate.js | 332 | 235 | todo
js/import/cards.js | 309 | 223 | todo
js/sent.js | 261 | 219 | todo
js/agents/sensors.js | 265 | 213 | DONE (M607)
js/assemble/smallprose.js | 272 | 210 | DONE (M609)
js/ui/canonsettings.js | 249 | 203 | todo
js/agents/canonlens.js | 255 | 198 | DONE (M607)
js/engine/bodies.js | 286 | 198 | DONE (M593)
js/agents/planner.js | 235 | 186 | DONE (M607)
js/agents/ripple.js | 246 | 185 | DONE (M607)
js/agents/editor.js | 237 | 182 | DONE (M607)
js/engine/whole.js | 255 | 181 | DONE (M593)
js/assemble/craft.js | 232 | 179 | DONE (M609)
sw.js | 217 | 179 | todo
js/agents/canontidy.js | 228 | 178 | DONE (M607)
js/engine/referee-math.js | 282 | 176 | DONE (M593)
js/agents/choices.js | 217 | 174 | DONE (M607)
js/agents/queue.js | 279 | 174 | DONE (M607)
js/agents/tidy.js | 208 | 171 | DONE (M607)
js/import/sillytavern.js | 233 | 164 | todo
js/ui/prose.js | 221 | 164 | todo
js/agents/worldground.js | 201 | 155 | DONE (M608)
js/commands.js | 232 | 153 | todo
js/ui/welcome.js | 216 | 153 | todo
js/assemble/voice.js | 262 | 150 | DONE (M609)
js/engine/names.js | 231 | 148 | DONE (M579)
js/ui/ownwords.js | 176 | 142 | todo
js/ui/speechcolours.js | 179 | 142 | todo
js/engine/clock.js | 218 | 141 | DONE (M593)
js/import/v176map.js | 204 | 137 | todo
js/engine/offscreen.js | 232 | 132 | DONE (M593)
js/agents/lookup.js | 170 | 121 | DONE (M608)
js/agents/plans.js | 149 | 117 | DONE (M608)
js/engine/usage.js | 144 | 114 | DONE (M593)
js/providers/index.js | 149 | 113 | todo
js/agents/essentials.js | 154 | 111 | DONE (M608)
js/agents/lint.js | 174 | 108 | DONE (M608)
js/assemble/anchor.js | 149 | 108 | DONE (M609)
js/assemble/plain.js | 170 | 106 | DONE (M609)
js/engine/relationships.js | 157 | 105 | DONE (M593)
js/ui/workbanner.js | 151 | 105 | todo
js/agents/canoncheck.js | 130 | 100 | DONE (M608)
js/ui/usage.js | 108 | 98 | todo
js/providers/meter.js | 111 | 97 | DONE (M609)
js/ui/pagemark.js | 122 | 94 | todo
js/engine/canon.js | 147 | 92 | DONE (M593)
js/import/chats.js | 143 | 92 | todo
js/tablock.js | 131 | 91 | todo
js/agents/canonstart.js | 128 | 90 | DONE (M608)
js/agents/status.js | 160 | 87 | DONE (M607)
js/agents/jsonutil.js | 119 | 85 | DONE (M607)
js/providers/speed.js | 110 | 83 | DONE (M609)
js/agents/call.js | 184 | 78 | DONE (M607)
js/assemble/plainvoice.js | 98 | 71 | DONE (M609)
js/agents/recallpick.js | 84 | 65 | DONE (M608)
js/providers/relay.js | 85 | 63 | DONE (M609)
js/engine/voicepresets.js | 86 | 61 | DONE (M593)
js/ui/richhtml.js | 98 | 59 | DONE (M574)
js/assemble/laws.js | 114 | 56 | DONE (M608)
js/canon/host.js | 71 | 53 | todo
js/ui/streamtext.js | 61 | 48 | todo
js/assemble/planwords.js | 70 | 47 | DONE (M609)
js/providers/room.js | 72 | 47 | DONE (M609)
js/providers/detect.js | 59 | 41 | DONE (M609)
js/providers/sse.js | 57 | 38 | DONE (M609)
js/assemble/canonpages.js | 62 | 37 | DONE (M608)
js/agents/concept.js | 56 | 36 | DONE (M608)
js/providers/wire.js | 49 | 36 | DONE (M609)
js/providers/knobs.js | 50 | 34 | DONE (M609)
js/assemble/receipt.js | 60 | 33 | DONE (M608)
js/ui/storyexport.js | 45 | 33 | todo
js/agents/assign.js | 44 | 28 | DONE (M608)
js/providers/userfirst.js | 40 | 24 | DONE (M609)
js/assemble/planbook.js | 30 | 20 | DONE (M608)
js/ui/placeholder.js | 26 | 19 | todo
js/engine/sentence.js | 22 | 17 | DONE (M593)
js/engine/window.js | 38 | 17 | DONE (M593)
js/engine/pagecut.js | 40 | 16 | todo
js/providers/latesystem.js | 24 | 14 | DONE (M609)
js/ui/download.js | 16 | 11 | todo
js/providers/order.js | 25 | 10 | DONE (M609)
js/agents/voice.js | 16 | 4 | DONE (M608)
js/agents/herewords.js | 8 | 1 | DONE (M608)
js/version.js | 10 | 1 | todo
