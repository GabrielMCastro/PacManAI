// Standalone viewer for the networks saved in ai/seeds, loaded by visualize.html
// (open http://localhost:8000/visualize.html with the server running). visualize.html is just this
// script, some link/node hover styles and an empty <body id="visbody">: every saved network
// net_0.txt ... net_199.txt is drawn into it, one large diagram each, using the same NetworkVisualizer
// as the training page.
//
// NOTE: importing simulationenvironment.js runs that whole module first. It isn't a quiet import: its top
// level looks up index.html's elements and wires up buttons, and at the end starts a training run.
// On visualize.html those elements don't exist, so as far as can be told from the code it throws at its
// first headlessBtn.addEventListener (headlessBtn is null) before reaching startTraining. A module whose
// import throws doesn't run either, so this file's code below would never execute. getTrainer is only
// used for the console.log below.
import { NetworkVisualizer } from "/ai/networkVisualizer.js"
import { getTrainer } from "./simulationenvironment.js"


// Parsed from each seed file, then handed to NetworkVisualizer
let genes, innovations, inputs, hidden, outputs;
console.log(getTrainer())
// 200 is a fixed upper bound, not the number of networks actually saved
for (let i = 0; i < 200; i++) {

// Synchronous request (third argument false), so each file is parsed before it's drawn.
// NOTE: the URL is hard-coded to localhost:8000, so this only works on the server's default port
let rawFile = new XMLHttpRequest()
rawFile.open("GET", `http://localhost:8000/ai/seeds/net_${i}.txt`, false)
rawFile.onreadystatechange = () => {
    // status 0 is what a file:// request reports (a failed request reports it too)
    if(rawFile.status === 200 || rawFile.status == 0)
    {
        // A seed file is JSON: ["innovations.inputs.hidden.outputs.", ["gene", ...]] (written by entry.js).
        // Stripping the brackets and quotes and splitting on commas gives [header, gene, gene, ...]
        // (genes never contain commas). Same parsing as the trainer's seed loading in ai/aiTrainer.js
        let allText = rawFile.responseText;
        let genome = allText.replace(/\[/g, "").replace(/\]/g, "")
                            .replace(/\"/g, "").split(",")

        let global = genome[0].split(".")
        innovations = parseInt(global[0])
        inputs =  parseInt(global[1])
        hidden =  parseInt(global[2])
        outputs = parseInt(global[3])

        // NOTE: unlike the trainer, this doesn't filter out the [""] a network with no connections parses to
        genes = genome.slice(1)
    }
}
rawFile.send(null)

// NOTE: a missing file (404) skips the parsing above but still draws, reusing the previous network's genes
// (or undefined genes for net_0), so fewer than 200 saved networks gives repeated or failing diagrams
let visualizer = NetworkVisualizer(genes, { innovations, inputs, hidden, outputs }, `net_${i}`)
visualizer.init()
visualizer.visualize(document.getElementById("visbody"), 1010, 800)
}
