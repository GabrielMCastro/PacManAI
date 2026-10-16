import { NetworkVisualizer } from "/ai/networkVisualizer.js"
import { getTrainer } from "./simulationenvironment.js"


let genes, innovations, inputs, hidden, outputs;
console.log(getTrainer())
for (let i = 0; i < 200; i++) {

let rawFile = new XMLHttpRequest()
rawFile.open("GET", `http://localhost:8000/ai/seeds/net_${i}.txt`, false)
rawFile.onreadystatechange = () => {
    if(rawFile.status === 200 || rawFile.status == 0)
    {
        let allText = rawFile.responseText;
        let genome = allText.replace(/\[/g, "").replace(/\]/g, "")
                            .replace(/\"/g, "").split(",")

        let global = genome[0].split(".")
        innovations = parseInt(global[0])
        inputs =  parseInt(global[1])
        hidden =  parseInt(global[2])
        outputs = parseInt(global[3])

        genes = genome.slice(1)
    }
}
rawFile.send(null)

let visualizer = NetworkVisualizer(genes, { innovations, inputs, hidden, outputs }, `net_${i}`)
visualizer.init()
visualizer.visualize(document.getElementById("visbody"), 1010, 800)
}