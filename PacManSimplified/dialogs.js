// Modal dialogs and toasts for the training page
//
// Used by simulationenvironment.js:
//   editConfig()    - the training config editor (config button), resolves with the edited config
//   confirmDialog() - yes/no questions (restart training, save networks)
//   toast()         - short status/error messages
// The dialogs are plain <dialog> elements built on the fly, styled by the .modal / .config-* / .toast rules
// in index.html. Everything returns promises so callers can just await the user's answer.

import { INPUT_SIGNALS, inputCount } from "./game.js"
import { MAP, MAP_NAMES, POWER_PILLS, OBJECTS } from "./objects/definitions.js"

// Map choices: name, pellet count, and a note when the power pill mode would have no pills
// value is the map's index in MAP, which is what config.MapIndex holds
const MAP_OPTIONS = MAP.map((m, i) => {
    let pellets = m.flat().filter(b => b === OBJECTS.BISCUIT).length
    return { value: i, label: `${MAP_NAMES[i]} · ${pellets} pellets${POWER_PILLS[i]?.length ? "" : " · no power pills"}` }
})

// Labels for the input signals selector, in INPUT_SIGNALS order
const SIGNAL_LABELS = { pellets: "Pellets", ghosts: "Ghosts", pills: "Power pills", vulnerableGhosts: "Vulnerable ghosts" }

// InputSignals for the first `level` signals in INPUT_SIGNALS order, and back
// The selector stores a single number, the level: 0 = open space only, 1 = + pellets, 2 = + ghosts, ...
// levelForSignals counts the leading run of selected signals, so a selection with a gap
// (e.g. ghosts without pellets) comes back as the level before the gap
const signalsForLevel = (level) => Object.fromEntries(INPUT_SIGNALS.map((s, i) => [s, i < level]))
const levelForSignals = (signals) => {
    let level = INPUT_SIGNALS.findIndex(s => !signals?.[s])
    return level == -1 ? INPUT_SIGNALS.length : level // Every signal selected
}

// Every editable config option, see ai/aiTrainer.js for what they do.
// Outputs and GPUMultiplication are left out: the game always has 4 moves and the GPU path is broken.
//
// Grouped into fieldsets. Each field:
//   key   - the config option, dotted for nested ones ("Compatibility.c1"), read and written with getPath/setPath
//   label - shown next to the input
//   type  - "int"     number input that must be a whole number
//           "number"  number input, any finite number
//           "bool"    checkbox
//           "select"  dropdown of `options` ({ value, label }), the value is stored as a number
//           "signals" the stepped input signals selector (signalsRow), stored as an InputSignals object
//   min, max - optional bounds checked by validate() (and set on the input)
//   hint  - optional help text under the input
// The order here is the order on screen and the order fields are validated in.
const CONFIG_FIELDS = [
    { group: "Population", fields: [
        { key: "SimNum", label: "Simulations", type: "int", min: 1, hint: "Games running side by side" },
        { key: "PopulationSize", label: "Population size", type: "int", min: 1, hint: "Networks per generation" },
        { key: "MaxGens", label: "Generations", type: "int", min: 1, hint: "Training stops after this many" },
    ]},
    { group: "Inputs", fields: [
        // Signals can only be added in INPUT_SIGNALS order, so networks seeded from an earlier stage
        // only ever gain inputs at the end (where NewInputs adds them)
        { key: "InputSignals", label: "Input signals", type: "signals" },
    ]},
    { group: "Network", fields: [
        { key: "FullyConnected", label: "Fully connected", type: "bool", hint: "Start with every input connected to every output, otherwise no connections" },
        { key: "Bias", label: "Bias", type: "number", hint: "Added to every node before activation" },
    ]},
    { group: "Mutation", fields: [
        { key: "WeightMutationR", label: "Weight mutation rate", type: "number", min: 0, max: 1, hint: "Chance per gene of a weight mutation: 90% a small nudge, 10% a new random weight" },
        { key: "StructureMutationR", label: "Structure mutation rate", type: "number", min: 0, max: 1, hint: "Chance per child of adding a node or a connection" },
        { key: "StructureMutationSplit", label: "Node vs connection split", type: "number", min: -1, max: 1, hint: "Chance a structural mutation adds a node. -1 = dynamic" },
        { key: "DynamicSplitFactor", label: "Dynamic split factor", type: "number", min: 0, hint: "Dynamic split only, lower prefers adding connections for longer" },
    ]},
    { group: "Speciation", fields: [
        { key: "Compatibility.c1", label: "Excess weight (c1)", type: "number", min: 0 },
        { key: "Compatibility.c2", label: "Disjoint weight (c2)", type: "number", min: 0 },
        { key: "Compatibility.c3", label: "Weight difference (c3)", type: "number", min: 0 },
        { key: "Compatibility.threshold", label: "Threshold", type: "number", min: 0, hint: "Networks closer than this to a species join it" },
    ]},
    // The Game options aren't trainer options, simulationenvironment.js adds them to the config it
    // passes in and hands them to each Game (gameOptions)
    { group: "Game", fields: [
        { key: "MapIndex", label: "Map", type: "select", options: MAP_OPTIONS, hint: "The board every game is played on" },
        { key: "GhostCount", label: "Ghosts", type: "int", min: 1, max: 4, hint: "Ghosts in the ghost and power pill modes. Start with 1 and add more as the average flattens" },
        { key: "DecideOnTileCenter", label: "Decide on tile centers", type: "bool", hint: "Network only picks a move when pacman is centered on a tile. Stops it reversing back and forth on one spot, turn off after training to react every tick" },
    ]},
    { group: "Fitness", fields: [
        { key: "GamesPerNetwork", label: "Games per network", type: "int", min: 1, hint: "Fitness is the average of this many games, so one lucky game counts for less" },
        { key: "SurvivalBonus", label: "Survival bonus", type: "number", min: 0, hint: "Points per second alive, a pellet is 10. 0 = off" },
    ]},
    { group: "Reproduction", fields: [
        { key: "ReproductionPercentile", label: "Reproduction percentile", type: "number", min: 0, max: 1, hint: "Only networks above this percentile of their species reproduce" },
    ]},
    // Seeding loads networks saved in ai/seeds (by the save button or at the end of a run) to continue
    // from them, e.g. a pellets-only population as the start of a ghosts stage with more inputs
    { group: "Seeding", fields: [
        { key: "SeedNumber", label: "Seed networks", type: "int", min: 0, hint: "Networks to load from ai/seeds into generation 1, 0 = start from scratch" },
        { key: "NewInputs", label: "New inputs", type: "int", min: 0, hint: "Extra inputs added on top of the seeded networks" },
        { key: "ProtectStructure", label: "Protect structure", type: "bool", hint: "Never split the seeded connections" },
    ]},
]

// Read/write a possibly nested option by its dotted key, e.g. getPath(config, "Compatibility.c1").
// getPath returns undefined if any part of the path is missing; setPath creates missing objects on the way
const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
const setPath = (obj, path, value) => {
    let keys = path.split(".")
    let last = keys.pop()
    keys.reduce((o, k) => o[k] ??= {}, obj)[last] = value
}

// Builds a <dialog> with a title, body and buttons. Resolves with the value of the button
// pressed, or null if closed with Escape
//   title   - heading text
//   body    - a DOM node (or string) put in the dialog body
//   buttons - [{ label, value, primary, danger }], in order. primary/danger only change the styling.
//             value can be an object with validate() and a result property: the button then only closes
//             the dialog if validate() returns true, and resolves with value.result (editConfig's Save uses this)
// Returns { dialog, result }: the element, for callers that want to tweak it, and the promise.
// The dialog removes itself from the page when it closes.
function modal(title, body, buttons) {
    let dialog = document.createElement("dialog")
    dialog.className = "modal"
    dialog.innerHTML = `<h2 class="modal-title"></h2><div class="modal-body"></div><div class="modal-actions"></div>`
    // textContent, not innerHTML, so the title can't inject markup
    dialog.querySelector(".modal-title").textContent = title
    dialog.querySelector(".modal-body").append(body)

    let result = new Promise(resolve => {
        buttons.forEach(({ label, value, primary, danger }) => {
            let btn = document.createElement("button")
            btn.type = "button"
            btn.className = `btn${primary ? " primary" : ""}${danger ? " danger" : ""}`
            btn.textContent = label
            btn.addEventListener("click", () => {
                if (value?.validate && !value.validate()) return
                dialog.close()
                resolve(value?.validate ? value.result : value)
            })
            dialog.querySelector(".modal-actions").append(btn)
        })
        // A promise only settles once, so these resolve(null) calls do nothing after a button resolved it
        dialog.addEventListener("cancel", () => resolve(null))
        dialog.addEventListener("close", () => { dialog.remove(); resolve(null) })
    })

    document.body.append(dialog)
    dialog.showModal()
    return { dialog, result }
}

// Asks a yes/no question, resolves to true if confirmed
//   danger - style the confirm button as destructive (e.g. restarting training)
// Escape and Cancel both resolve to false
export function confirmDialog(title, message, confirmLabel, danger = false) {
    let body = document.createElement("p")
    body.textContent = message
    return modal(title, body, [
        { label: "Cancel", value: false },
        { label: confirmLabel, value: true, primary: !danger, danger },
    ]).result.then(v => v === true)
}

// Segmented selector for the input signals. Each step adds one signal on top of the ones before it,
// so the selection is always the first N of INPUT_SIGNALS. Radios underneath, so arrow keys work
//   f     - the CONFIG_FIELDS entry
//   value - the current InputSignals object
// Returns the row element. The radio values are levels (0 = open space only), validate() turns the
// checked one back into an InputSignals object with signalsForLevel.
// Why only the first N: getInput() in game.js returns the selected signals in INPUT_SIGNALS order. When a
// later stage is seeded from saved networks, NewInputs appends the new input nodes after the old ones, so the
// new signals have to come after the old ones in that order too. Skipping a signal would put a later-added
// one in the middle and shift inputs the seeded networks already learned on.
function signalsRow(f, value) {
    let row = document.createElement("div")
    row.className = "config-row config-signals"
    let steps = ["Open space", ...INPUT_SIGNALS.map(s => `+ ${SIGNAL_LABELS[s]}`)]
    row.innerHTML = `
        <span class="config-label" id="cfg_${f.key}_label">${f.label}</span>
        <div class="signal-steps" role="radiogroup" aria-labelledby="cfg_${f.key}_label">
            ${steps.map((label, i) => `
                <label><input type="radio" name="${f.key}" value="${i}"><span>${label}</span></label>`).join("")}
        </div>
        <small></small>`

    let radios = [...row.querySelectorAll("input")]
    let hint = row.querySelector("small")
    radios[levelForSignals(value)].checked = true

    // Fill every step up to the selected one, and describe the resulting inputs
    function paint() {
        let level = radios.findIndex(r => r.checked)
        radios.forEach((r, i) => {
            r.parentElement.classList.toggle("included", i <= level)
            r.parentElement.classList.toggle("selected", i == level)
        })
        let names = ["open space", ...INPUT_SIGNALS.slice(0, level).map(s => SIGNAL_LABELS[s].toLowerCase())]
        hint.textContent = `${inputCount(signalsForLevel(level))} inputs: ${names.join(", ")}. ` +
            "Each step adds 4 inputs after the ones before it, so seeded networks keep their input order"
    }
    radios.forEach(r => r.addEventListener("change", paint))
    paint()
    return row
}

// Shows the config editor for the current config. Resolves with the edited config once saved
// and confirmed, or null if cancelled. seedCount is the number of networks in ai/seeds, null if unknown
//   current - the config to start from: the trainer's getConfig() plus the Game options and InputSignals
//             (see the config button in simulationenvironment.js). It isn't modified, edits go to a copy
// The result contains every key of `current` with the edited fields replaced. The caller merges it over
// its own config and restarts training with it, which can still refuse it (e.g. seed input count mismatch).
// Steps: build the form from CONFIG_FIELDS -> modal with Cancel/Save -> Save runs validate(), which keeps
// the dialog open on errors -> a second dialog confirms the restart, since saving throws away the current run.
export async function editConfig(current, seedCount) {
    let form = document.createElement("form")
    form.className = "config-form"
    form.noValidate = true // validate() shows its own messages instead of the browser's

    for (let { group, fields } of CONFIG_FIELDS) {
        let fieldset = document.createElement("fieldset")
        fieldset.innerHTML = `<legend>${group}</legend>`

        for (let f of fields) {
            // Element ids can't use the dot of nested keys in CSS selectors comfortably, so it becomes _
            // (only the first dot, keys are at most one level deep)
            let id = `cfg_${f.key.replace(".", "_")}`
            let value = getPath(current, f.key)
            if (f.type == "signals") {
                fieldset.append(signalsRow(f, value))
                continue
            }
            let row = document.createElement("div")
            row.className = `config-row${f.type == "bool" ? " config-bool" : ""}`

            // The seed count is only known when the editor opens, so it's added to the hint here
            let hint = f.hint ?? ""
            if (f.key == "SeedNumber") {
                hint += seedCount == null ? ". Couldn't check how many are saved" : `. ${seedCount} saved`
            }

            // Inputs are named by their key, so validate() can find them with form.elements[key]
            row.innerHTML = f.type == "bool"
                ? `<label for="${id}"><input type="checkbox" id="${id}" name="${f.key}"> ${f.label}</label>`
                : f.type == "select"
                ? `<label for="${id}">${f.label}</label>
                   <select id="${id}" name="${f.key}">
                       ${f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join("")}
                   </select>`
                : `<label for="${id}">${f.label}</label>
                   <input type="number" id="${id}" name="${f.key}" step="${f.type == "int" ? 1 : "any"}"
                          ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}>`
            let input = row.querySelector("input, select")
            if (f.type == "bool") input.checked = !!value
            else input.value = value

            if (hint) {
                let small = document.createElement("small")
                small.textContent = hint
                row.append(small)
            }
            // Hidden until validate() marks the row invalid (see .config-row.invalid in index.html)
            let error = document.createElement("small")
            error.className = "config-error"
            row.append(error)

            fieldset.append(row)
        }
        form.append(fieldset)
    }

    // Read the form back into a config, marking any invalid fields
    // Returns true if everything is valid. Either way the config read is left in `edited`, which the
    // Save button resolves with (only once validate() passes).
    // Checks per field: a finite number, whole for "int", within min/max. Then two cross-field checks,
    // only once every field is valid: SimNum <= PopulationSize, and SeedNumber <= the networks saved.
    let edited = null
    function validate() {
        let config = structuredClone(current)
        let ok = true
        let fail = (key, message) => {
            let row = form.elements[key].closest(".config-row")
            row.classList.add("invalid")
            row.querySelector(".config-error").textContent = message
            ok = false
        }
        form.querySelectorAll(".config-row").forEach(r => r.classList.remove("invalid"))

        for (let { fields } of CONFIG_FIELDS) {
            for (let f of fields) {
                let input = form.elements[f.key]
                if (f.type == "signals") {
                    // input is the radio group here (a RadioNodeList), its value is the checked level
                    setPath(config, f.key, signalsForLevel(Number(input.value)))
                    continue
                }
                if (f.type == "bool") {
                    setPath(config, f.key, input.checked)
                    continue
                }
                if (f.type == "select") {
                    setPath(config, f.key, Number(input.value))
                    continue
                }
                let n = Number(input.value)
                if (input.value.trim() == "" || !Number.isFinite(n)) fail(f.key, "Enter a number")
                else if (f.type == "int" && !Number.isInteger(n)) fail(f.key, "Enter a whole number")
                else if (f.min != null && n < f.min) fail(f.key, `Must be at least ${f.min}`)
                else if (f.max != null && n > f.max) fail(f.key, `Must be at most ${f.max}`)
                setPath(config, f.key, n) // Written even if invalid, the config is only used when ok
            }
        }

        // Every game plays its own network, more games than networks would leave some with nothing to play
        if (ok && config.SimNum > config.PopulationSize) {
            fail("SimNum", "Can't be more than the population size")
        }
        // Skipped when the count is unknown, the trainer then finds out when it loads the files
        if (ok && seedCount != null && config.SeedNumber > seedCount) {
            fail("SeedNumber", `Only ${seedCount} networks are saved in ai/seeds`)
        }

        edited = config
        if (!ok) form.querySelector(".invalid input")?.focus()
        return ok
    }

    // Save button value: modal() runs validate() and resolves with result (the edited config) if it passes
    let save = { validate, get result() { return edited } }
    let { dialog, result } = modal("Training config", form, [
        { label: "Cancel", value: null },
        { label: "Save", value: save, primary: true },
    ])
    dialog.classList.add("modal-wide")
    // Enter in a field saves
    // (only number fields, Enter on a checkbox or radio keeps its usual behaviour)
    form.addEventListener("keydown", e => {
        if (e.key == "Enter" && e.target.type == "number") {
            e.preventDefault()
            dialog.querySelector(".modal-actions .primary").click()
        }
    })

    let config = await result
    if (!config) return null

    // Saving restarts the run, ask first. Answering no throws away the edits too
    let confirmed = await confirmDialog("Restart training?",
        "Saving the config restarts training from generation 1. Progress in the current run is lost.",
        "Restart training", true)
    return confirmed ? config : null
}

// Shows a short message in the corner of the page
//   error - red styling and shown for 6s instead of 3s
// Adding the hide class starts a CSS fade out (see .toast in index.html), the element is removed when it ends
export function toast(message, error = false) {
    let el = document.createElement("div")
    el.className = `toast${error ? " error" : ""}`
    el.setAttribute("role", "status") // Screen readers announce it
    el.textContent = message
    document.body.append(el)
    setTimeout(() => el.classList.add("hide"), error ? 6000 : 3000)
    el.addEventListener("transitionend", () => el.remove())
}
