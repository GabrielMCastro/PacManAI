/**
 *  Network Visualizer
 *  Draws one network's genome as an SVG diagram with d3: inputs in the left column, hidden nodes in columns by
 *  depth, outputs in the right column, and a line per enabled connection (green = positive weight,
 *  red = negative, thicker = larger weight).
 *
 *  Used in two places:
 *      - simulationenvironment.js scheduleVisualization(), after each generation, one small card per network
 *      - visualize.js (visualize.html), to look at saved seed networks (ai/seeds/net_N.txt)
 *  Usage: let v = NetworkVisualizer(genome, globalInfo, id); v.init(); v.visualize(containerElement, width, height)
 *
 *  Parameters:
 *      1. genome - array of gene strings ("innovation.from.to.weight.enabled", see neuralNetwork.js)
 *      2. globalInfo - the population's {inputs, hidden, outputs, innovations}, needed to tell inputs,
 *         outputs and hidden nodes apart by their number
 *      3. id - the network's name, shown as the card title
 */
// NOTE: complex is imported but not used in this file
import {complex, multiply} from "https://dev.jspm.io/mathjs";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm"
import { NeuralNetwork } from "/ai/neuralNetwork.js"

export const NetworkVisualizer = function (genome, globalInfo, id) 
{
    // A throwaway network, only used to build the matrices from the genome (generateNetwork) and read them back.
    // Bias 1 and do-nothing activations since execute() is never called, gpuMult and protectedInnovations off
    let network = NeuralNetwork(genome, 1, () => {}, () => {}, id, () => globalInfo, false, false)
    let nodes = new Map()  // id -> {id, layer, lidx, x, y}. id is "i<node>" for inputs, "h<node>" for hidden, "o<n>" for outputs
    let links = []         // [{source: node id, target: node id, weight}], one per non-zero matrix entry (enabled gene)
    let layers = 0         // After init: the layer (column) number the outputs are drawn in, i.e. columns = layers + 1
    let boxLayer = -1      // Layer of the nodes stuck in a cycle (drawn in a ring), -1 if there's no cycle

    // Work out which layer every node is drawn in. This uses the same trick as the forward pass
    // (see neuralNetwork.js): hidden nodes start as i and each multiply resolves the nodes whose
    // inputs are all known, so the pass a node resolves on is its layer. Nodes in a cycle never resolve,
    // they're drawn in a ring in their own layer (boxLayer)
    //
    // Fills in `nodes`, `links`, `layers` and `boxLayer`. Must be called before visualize(). Returns nothing.
    //
    // Steps:
    //   1. Build the network's matrices and tag each maskOrder entry as input (layer 0) or hidden (-1 = unknown)
    //   2. Repeat mask x networkMatrix. Every hidden node whose sum turned real gets the current layer number,
    //      and is set to 1 (a real placeholder, the actual value doesn't matter, only "known or not")
    //   3. Make a node entry for every input and hidden node. Nodes that never resolved (in or after a cycle)
    //      get the layer after the last one, which becomes the ring layer (boxLayer)
    //   4. Outputs go in the last layer
    //   5. One link per non-zero weight in networkMatrix and outputMatrix
    //
    // Example: inputs 4, 5, hidden 6 fed by 4 and 5, hidden 7 fed by 6, 7 -> output 0
    //   layer 0: i4, i5   layer 1: h6   layer 2: h7   layer 3: o0, o1, o2, o3
    // With a cycle 6 -> 7 -> 6 instead, neither resolves: they both go in layer 1 (the ring) and the outputs in 2
    function init() {
        // 1. Build the matrices (see generateNetwork in neuralNetwork.js for their shapes)
        network.generateNetwork()
        let { mask, maskOrder, networkMatrix, outputMatrix } = network.getMatrices()

        // Turn each maskOrder entry into [node number, layer]: inputs (mask value 0) are layer 0,
        // hidden nodes (mask value i) start at -1 meaning "not placed yet".
        // (A math.js Complex i isn't == 0, so only inputs pass the test.)
        // This overwrites the throwaway network's own maskOrder array, which is fine since it's never executed
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] == 0) {
                maskOrder[i] = [maskOrder[i], 0]
            } else {
                maskOrder[i] = [maskOrder[i], -1]
            }
        }

        // 2. Resolve hidden nodes pass by pass, like execute() in neuralNetwork.js.
        // The inputs stay 0 here, only whether a sum has an imaginary part matters, not its value.
        // `layers` is the layer number to give the nodes resolved by the current pass. It only goes up after a
        // pass that resolved something, so the hidden layers are numbered 1, 2, 3... with no gaps.
        // Same limit as execute(): at most one pass per node, hitting it means a cycle.
        // NOTE: the same imaginary cancellation quirk applies (sum i - i looks real), so a node can be placed
        // in an earlier layer than its sources
        let product = []
        let tmpMask = [...mask]

        let passes = 0
        layers = 1
        let layersIncr = false  // Did this pass resolve any node?
        while (stillImaginary(tmpMask) && passes < tmpMask.length) {
            passes += 1
            layersIncr = false
            // product[k] = sum into node maskOrder[k][0], a number or a math.js Complex
            product = multiply(tmpMask, networkMatrix)
            for (let i = 0; i < product.length; i++) {
                if (typeof(tmpMask[i]) == "object") { // Still unresolved (Complex i)
                    // Sum is real -> every source is known, the node belongs to this layer
                    if (typeof(product[i]) == "number" || (typeof(product[i]) == "object" && product[i].im == 0)) {
                        maskOrder[i][1] = layers
                        layersIncr = true
                        tmpMask[i] = 1 // Any real number works, 1 just marks it as resolved
                    }
                }
            }
            if (layersIncr) {
                layers += 1
            }
        }
        // Now `layers` is the first unused layer number


        // 3. One node per input/hidden node in maskOrder. tmpMask is still 0 only for inputs (hidden nodes are
        // 1 or still Complex), which gives the "i"/"h" prefix. Unresolved nodes (-1) go in layer `layers`,
        // which becomes the ring layer below.
        // NOTE: hidden nodes without outgoing connections aren't in maskOrder, so they (and the links into
        // them) aren't drawn. Unused inputs aren't drawn either
        for (let i = 0; i < maskOrder.length; i++) {
            let id = `${tmpMask[i] == 0 ? 'i' : 'h'}${maskOrder[i][0]}`
            nodes.set(id, { id, layer: maskOrder[i][1] == -1 ? layers : maskOrder[i][1] })
        }

        // Hit the pass limit -> some nodes are in (or downstream of) a cycle: their layer is the ring layer
        // and the outputs move one layer further right.
        // NOTE: if the last node happens to resolve exactly on the final allowed pass, this still runs and
        // leaves an empty ring layer (only possible in an odd network where no input has a connection)
        if (passes >= tmpMask.length) {
            boxLayer = layers
            layers += 1
        }

        // 4. Output nodes, one per column of outputMatrix, all in the last layer. Their ids use the output index,
        // which is also their node number (outputs are numbered 0 .. outputs-1).
        // If the network has no connections, outputMatrix is [] and no outputs are added
        for (let i = 0; i < outputMatrix[0]?.length; i++) {
            let id = `o${i}`
            nodes.set(id, { id, layer: layers })
        }

        // 5. Links. Row i / column j of networkMatrix are nodes maskOrder[i] / maskOrder[j], the ids are rebuilt
        // the same way as in step 3. Disabled genes are 0 in the matrices, so they aren't drawn
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

        // Links into the outputs, column j of outputMatrix is output node j
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

    // True if any node in the mask is still unresolved (a math.js Complex object rather than a number).
    // Same as stillImaginary in neuralNetwork.js without the GPU path. Used by init()
    function stillImaginary(mask) {
        for (let i = 0; i < mask.length; i++) {
            if (typeof(mask[i]) == "object") return true
        }
        return false
    }

    // Draws the network into a titled card appended to the container element
    // container - DOM element to append the card to, width/height - size of the SVG in pixels
    // (337 x 267 for the per-generation cards, 1010 x 800 in visualize.js). Call init() first. Returns nothing.
    //
    // Layout: one column per layer, nodes spread evenly down their column and centered vertically.
    // Steps:
    //   1. Card title and subtitle, or a "No connections yet" box if there's nothing to draw
    //   2. Count the nodes per layer (netsize) and give each node its position within its layer (lidx)
    //   3. Column width xdist = width / number of layers, row height ydist = height / size of the largest layer
    //   4. Position the nodes: column centers for x, centered rows for y, a ring for the cycle layer
    //   5. Draw the links first, then the nodes on top (circle colored by layer plus its id as a label)
    function visualize(container, width, height) {
        // nodeSize = circle radius, scaled with the height: 30px at 800px tall (the commented part is an older formula)
        let nodeSize = (30 * height) / 800//(width / layers) * .15
        let lineWidth = 3  // Line width for a weight of 1, scaled by sqrt(|weight|)
        let color = d3.scaleOrdinal(d3.schemeTableau10)  // One color per layer
        // 1. Card with title and subtitle (classes styled by the page's css)
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

        // 2. Get network size
        // netsize[layer] = number of nodes in that layer. lidx = 1-based position of the node within its layer,
        // in the Map's insertion order (inputs and hidden nodes in node number order, then outputs)
        let netsize = {}
        nodes.forEach(function (n) {
            if (n.layer in netsize) {
                netsize[n.layer] += 1
            } else {
                netsize[n.layer] = 1
            }
            n["lidx"] = netsize[n.layer]
        })

        // 3. Calculate distance between nodes
        // xdist = width of one column, ydist = height of one row, sized so the largest layer fills the height.
        // NOTE: the number of columns is the number of non-empty layers, but x is computed from the layer number.
        // If a layer number is empty (e.g. no input has a connection so layer 0 is empty, or an empty ring layer)
        // the last column is pushed past the right edge of the SVG
        let largestLayerSize = Math.max.apply(
            null, Object.keys(netsize).map(function (i) { return netsize[i]; }));
    
        let xdist = width / Object.keys(netsize).length,
            ydist = height / largestLayerSize;

        // 4. create node locations
        // Normal layer: x = center of the layer's column. y = row lidx, shifted down by half the difference to the
        // largest layer, so every column is centered vertically.
        //   e.g. largest layer 4, this layer 2: rows at 1.5 and 2.5 (x ydist) instead of 0.5 and 1.5
        // Ring (cycle) layer: the nodes are spread evenly around a circle of radius xdist / 2 centered on the
        // column, boxTh = angle between neighbours, boxI = this node's index around the circle.
        // NOTE: the ring's vertical center is netsize[boxLayer] / 2 * ydist, half the ring layer's own size
        // rather than half the largest layer (the middle of the SVG), so it sits higher than the other columns
        // unless it's the largest layer. A large xdist can also push it past the top/bottom edge.
        // With no cycle boxLayer is -1, boxTh is NaN but unused
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

        // 5. draw links
        // One line per link from its source node's position to its target's. Drawn before the nodes so the
        // circles cover the line ends. Width grows with sqrt(|weight|) (weight 1 -> 3px, weight 3 -> ~5.2px),
        // green for positive weights, red for negative
        // (link, node and circle are kept in variables but not used afterwards)
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
        // One <g> group per node moved to its position, holding a circle (colored by layer) and its id as a label
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

    // Public interface: call init() once, then visualize()
    return {
        "init" : init,
        "visualize" : visualize
    }
}