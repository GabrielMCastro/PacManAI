import {complex, multiply} from "https://dev.jspm.io/mathjs";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm"
import { NeuralNetwork } from "/ai/neuralNetwork.js"

export const NetworkVisualizer = function (genome, globalInfo, id) 
{
    let network = NeuralNetwork(genome, 1, () => {}, () => {}, id, () => globalInfo, false, false)
    let nodes = new Map()
    let links = []
    let layers = 0
    let boxLayer = -1

    function init() {
        network.generateNetwork()
        let { mask, maskOrder, networkMatrix, outputMatrix } = network.getMatrices()

        for (let i = 0; i < mask.length; i++) {
            if (mask[i] == 0) {
                maskOrder[i] = [maskOrder[i], 0]
            } else {
                maskOrder[i] = [maskOrder[i], -1]
            }
        }

        let product = []
        let tmpMask = [...mask]

        let passes = 0
        layers = 1
        let layersIncr = false
        while (stillImaginary(tmpMask) && passes < tmpMask.length) {
            passes += 1
            layersIncr = false
            product = multiply(tmpMask, networkMatrix)
            for (let i = 0; i < product.length; i++) {
                if (typeof(tmpMask[i]) == "object") {
                    if (typeof(product[i]) == "number" || (typeof(product[i]) == "object" && product[i].im == 0)) {
                        maskOrder[i][1] = layers
                        layersIncr = true
                        tmpMask[i] = 1
                    }
                }
            }
            if (layersIncr) {
                layers += 1
            }
        }


        for (let i = 0; i < maskOrder.length; i++) {
            let id = `${tmpMask[i] == 0 ? 'i' : 'h'}${maskOrder[i][0]}`
            nodes.set(id, { id, layer: maskOrder[i][1] == -1 ? layers : maskOrder[i][1] })
        }

        if (passes >= tmpMask.length) {
            boxLayer = layers
            layers += 1
        }

        for (let i = 0; i < outputMatrix[0]?.length; i++) {
            let id = `o${i}`
            nodes.set(id, { id, layer: layers })
        }

        for (let i = 0; i < networkMatrix.length; i++) {
            for (let j = 0; j < networkMatrix[i].length; j++) {
                if (networkMatrix[i][j] !== 0) { 
                    links.push({
                        source: `${tmpMask[i] == 0 ? 'i' : 'h'}${maskOrder[i][0]}`,
                        target: `${tmpMask[j] == 0 ? 'i' : 'h'}${maskOrder[j][0]}`,
                        weight: networkMatrix[i][j]
                    })
                }
            }
        }

        for (let i = 0; i < outputMatrix.length; i++) {
            for (let j = 0; j < outputMatrix[i].length; j++) {
                if (outputMatrix[i][j] !== 0) { 
                    links.push({
                        source: `${tmpMask[i] == 0 ? 'i' : 'h'}${maskOrder[i][0]}`,
                        target: `o${j}`,
                        weight: outputMatrix[i][j]
                    })
                }
            }
        }
    }

    function stillImaginary(mask) {
        for (let i = 0; i < mask.length; i++) {
            if (typeof(mask[i]) == "object") return true
        }
        return false
    }

    // Draws the network into a titled card appended to the container element
    function visualize(container, width, height) {
        let nodeSize = (30 * height) / 800//(width / layers) * .15
        let lineWidth = 3
        let color = d3.scaleOrdinal(d3.schemeTableau10)
        let card = d3.select(container).append("div").attr("class", "vis-card")
        card.append("div").attr("class", "card-title").text(`Network ${network.getId()}`)
        card.append("div").attr("class", "card-subtitle")
            .text(`${nodes.size} nodes · ${links.length} connection${links.length == 1 ? "" : "s"}`)

        if (links.length == 0) {
            card.append("div").attr("class", "vis-empty")
                .style("width", width + "px").style("height", height + "px")
                .text("No connections yet")
            return
        }

        let svg = card.append("svg").attr("width", width).attr("height", height)

        // Get network size
        let netsize = {}
        nodes.forEach(function (n) {
            if (n.layer in netsize) {
                netsize[n.layer] += 1
            } else {
                netsize[n.layer] = 1
            }
            n["lidx"] = netsize[n.layer]
        })

        // Calculate distance between nodes
        let largestLayerSize = Math.max.apply(
            null, Object.keys(netsize).map(function (i) { return netsize[i]; }));
    
        let xdist = width / Object.keys(netsize).length,
            ydist = height / largestLayerSize;

        // create node locations
        let boxI = 0
        let boxTh = (2 * Math.PI) / netsize[boxLayer]
        nodes.forEach((n) => {
            if (n.layer == boxLayer) {
                n["x"] = (Math.cos(boxTh * boxI) * (xdist / 2)) + ((n.layer + 0.5) * xdist);
                n["y"] = (Math.sin(boxTh * boxI) * (xdist / 2)) + ((netsize[n.layer] / 2) * ydist);
                boxI += 1
            } else {
                n["x"] = (n.layer + 0.5) * xdist;
                n["y"] = ((n.lidx - 0.5) + ((largestLayerSize - netsize[n.layer]) / 2)) * ydist;
            }
        });

        // draw links
        let link = svg.selectAll(".link")
        .data(links)
        .enter().append("line")
        .attr("class", "link")
        .attr("x1", function(n) { return nodes.get(n.source).x; })
        .attr("y1", function(n) { return nodes.get(n.source).y; })
        .attr("x2", function(n) { return nodes.get(n.target).x; })
        .attr("y2", function(n) { return nodes.get(n.target).y; })
        .style("stroke-width", function(n) { return (Math.sqrt(Math.abs(n.weight)) * lineWidth); })
        .style("stroke", function(n) { return n.weight >= 0 ? "#4ade80" : "#f87171"});

        // draw nodes
        let node = svg.selectAll(".node")
        .data(nodes.values())
        .enter().append("g")
        .attr("transform", function(n) {
            return "translate(" + n.x + "," + n.y + ")"; }
        );

        let circle = node.append("circle")
        .attr("class", "node")
        .attr("r", nodeSize)
        .style("fill", function(n) { return color(n.layer); });


        node.append("text")
        .attr("class", "node-label")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .text(function(n) { return n.id; });
    }

    return {
        "init" : init,
        "visualize" : visualize
    }
}