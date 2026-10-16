// Modal dialogs and toasts for the training page

// Every editable config option, see ai/aiTrainer.js for what they do.
// Outputs and GPUMultiplication are left out: the game always has 4 moves and the GPU path is broken.
const CONFIG_FIELDS = [
    { group: "Population", fields: [
        { key: "SimNum", label: "Simulations", type: "int", min: 1, hint: "Games running side by side" },
        { key: "PopulationSize", label: "Population size", type: "int", min: 1, hint: "Networks per generation" },
        { key: "MaxGens", label: "Generations", type: "int", min: 1, hint: "Training stops after this many" },
    ]},
    { group: "Network", fields: [
        { key: "Inputs", label: "Inputs", type: "int", min: 1, hint: "Must match the length of getInput() in game.js" },
        { key: "FullyConnected", label: "Fully connected", type: "bool", hint: "Start with every input connected to every output, otherwise no connections" },
        { key: "Bias", label: "Bias", type: "number", hint: "Added to every node before activation" },
    ]},
    { group: "Mutation", fields: [
        { key: "WeightMutationR", label: "Weight mutation rate", type: "number", min: 0, max: 1, hint: "Chance per gene of a new random weight" },
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
            let row = document.createElement("div")
            row.className = `config-row${f.type == "bool" ? " config-bool" : ""}`

            let hint = f.hint ?? ""
            if (f.key == "SeedNumber") {
                hint += seedCount == null ? ". Couldn't check how many are saved" : `. ${seedCount} saved`
            }

            row.innerHTML = f.type == "bool"
                ? `<label for="${id}"><input type="checkbox" id="${id}" name="${f.key}"> ${f.label}</label>`
                : `<label for="${id}">${f.label}</label>
                   <input type="number" id="${id}" name="${f.key}" step="${f.type == "int" ? 1 : "any"}"
                          ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}>`
            let input = row.querySelector("input")
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
                if (f.type == "bool") {
                    setPath(config, f.key, input.checked)
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
