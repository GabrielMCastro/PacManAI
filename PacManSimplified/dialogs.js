// Modal dialogs and toasts for the training page

import { INPUT_SIGNALS, inputCount } from "./game.js"
import { MAP, MAP_NAMES, POWER_PILLS, OBJECTS } from "./objects/definitions.js"

// Map choices: name, pellet count, and a note when the power pill mode would have no pills
const MAP_OPTIONS = MAP.map((m, i) => {
    let pellets = m.flat().filter(b => b === OBJECTS.BISCUIT).length
    return { value: i, label: `${MAP_NAMES[i]} · ${pellets} pellets${POWER_PILLS[i]?.length ? "" : " · no power pills"}` }
})

// Labels for the input signals selector, in INPUT_SIGNALS order
const SIGNAL_LABELS = { pellets: "Pellets", ghosts: "Ghosts", pills: "Power pills", vulnerableGhosts: "Vulnerable ghosts" }

// InputSignals for the first `level` signals in INPUT_SIGNALS order, and back
const signalsForLevel = (level) => Object.fromEntries(INPUT_SIGNALS.map((s, i) => [s, i < level]))
const levelForSignals = (signals) => {
    let level = INPUT_SIGNALS.findIndex(s => !signals?.[s])
    return level == -1 ? INPUT_SIGNALS.length : level
}

// Every editable config option, see ai/aiTrainer.js for what they do.
// Outputs and GPUMultiplication are left out: the game always has 4 moves and the GPU path is broken.
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
    { group: "Seeding", fields: [
        { key: "SeedNumber", label: "Seed networks", type: "int", min: 0, hint: "Networks to load from ai/seeds into generation 1, 0 = start from scratch" },
        { key: "NewInputs", label: "New inputs", type: "int", min: 0, hint: "Extra inputs added on top of the seeded networks" },
        { key: "ProtectStructure", label: "Protect structure", type: "bool", hint: "Never split the seeded connections" },
    ]},
]

const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj)
const setPath = (obj, path, value) => {
    let keys = path.split(".")
    let last = keys.pop()
    keys.reduce((o, k) => o[k] ??= {}, obj)[last] = value
}

// Builds a <dialog> with a title, body and buttons. Resolves with the value of the button
// pressed, or null if closed with Escape
function modal(title, body, buttons) {
    let dialog = document.createElement("dialog")
    dialog.className = "modal"
    dialog.innerHTML = `<h2 class="modal-title"></h2><div class="modal-body"></div><div class="modal-actions"></div>`
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
        dialog.addEventListener("cancel", () => resolve(null))
        dialog.addEventListener("close", () => { dialog.remove(); resolve(null) })
    })

    document.body.append(dialog)
    dialog.showModal()
    return { dialog, result }
}

// Asks a yes/no question, resolves to true if confirmed
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
export async function editConfig(current, seedCount) {
    let form = document.createElement("form")
    form.className = "config-form"
    form.noValidate = true

    for (let { group, fields } of CONFIG_FIELDS) {
        let fieldset = document.createElement("fieldset")
        fieldset.innerHTML = `<legend>${group}</legend>`

        for (let f of fields) {
            let id = `cfg_${f.key.replace(".", "_")}`
            let value = getPath(current, f.key)
            if (f.type == "signals") {
                fieldset.append(signalsRow(f, value))
                continue
            }
            let row = document.createElement("div")
            row.className = `config-row${f.type == "bool" ? " config-bool" : ""}`

            let hint = f.hint ?? ""
            if (f.key == "SeedNumber") {
                hint += seedCount == null ? ". Couldn't check how many are saved" : `. ${seedCount} saved`
            }

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
            let error = document.createElement("small")
            error.className = "config-error"
            row.append(error)

            fieldset.append(row)
        }
        form.append(fieldset)
    }

    // Read the form back into a config, marking any invalid fields
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
                setPath(config, f.key, n)
            }
        }

        if (ok && config.SimNum > config.PopulationSize) {
            fail("SimNum", "Can't be more than the population size")
        }
        if (ok && seedCount != null && config.SeedNumber > seedCount) {
            fail("SeedNumber", `Only ${seedCount} networks are saved in ai/seeds`)
        }

        edited = config
        if (!ok) form.querySelector(".invalid input")?.focus()
        return ok
    }

    let save = { validate, get result() { return edited } }
    let { dialog, result } = modal("Training config", form, [
        { label: "Cancel", value: null },
        { label: "Save", value: save, primary: true },
    ])
    dialog.classList.add("modal-wide")
    // Enter in a field saves
    form.addEventListener("keydown", e => {
        if (e.key == "Enter" && e.target.type == "number") {
            e.preventDefault()
            dialog.querySelector(".modal-actions .primary").click()
        }
    })

    let config = await result
    if (!config) return null

    let confirmed = await confirmDialog("Restart training?",
        "Saving the config restarts training from generation 1. Progress in the current run is lost.",
        "Restart training", true)
    return confirmed ? config : null
}

// Shows a short message in the corner of the page
export function toast(message, error = false) {
    let el = document.createElement("div")
    el.className = `toast${error ? " error" : ""}`
    el.setAttribute("role", "status")
    el.textContent = message
    document.body.append(el)
    setTimeout(() => el.classList.add("hide"), error ? 6000 : 3000)
    el.addEventListener("transitionend", () => el.remove())
}
