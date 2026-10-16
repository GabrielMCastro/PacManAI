/**
 *  A Neural Network
 *  Gene encoding: v.w.x.y.z - each gene represents one connection
 *      v: global innovation number of gene
 *      w: input node
 *      x: output node
 *      y: weight (to be divided by 100)
 *      z: enable bit
 * 
 *  Parameters:
 *      1. genes - form of [innovationN.inputNode.outputNode.weight.enableBit]
 *      2. bias
 *      3. activation function
 *      4. output activation function
 *      5. returns the global info of the population - input nodes, all hidden nodes, output nodes, innovation numbers
 *
 *  Node numbering is shared across the population:
 *      outputs: 0 .. outputs-1 | inputs: outputs .. outputs+inputs-1 | hidden: after that
 *
 *  How the forward pass works (execute):
 *      Every hidden node starts with the value i (the imaginary unit), meaning "not computed yet".
 *      Multiplying the node values by the connection matrix gives each node's weighted input sum.
 *      Any connection from an uncomputed node adds an imaginary part to the sum, so a node whose
 *      sum is purely real has had all of its inputs computed, and it gets activated. Repeating this
 *      resolves the nodes layer by layer, in the right order, without sorting the graph first.
 *      A cycle never resolves, so after enough passes the imaginary parts are just dropped.
 *      Quirk: imaginary parts that cancel out (weights w and -w from two uncomputed nodes)
 *      make a node look computed too early.
 */
// import { GPU } from "gpu.js"
import {complex, multiply as mult} from "https://dev.jspm.io/mathjs";


export const NeuralNetwork = function (genes, bias, activation, outputActivation, id, getGlobalInfo, gpuMult, protectedInnovations) 
{
    let score = 0          // Fitness, the game score of this network's run
    let genome = genes     // Array of gene strings, see the encoding above
    let networkMatrix      // [from][to] weights between input/hidden nodes, indexed by position in maskOrder
    let outputMatrix       // [from][output] weights from input/hidden nodes to the output nodes
    let maskOrder          // Node numbers of every node that has an outgoing connection, in matrix order.
                           // Nodes without one (e.g. an input that isn't connected yet) aren't in the matrices at all
    let mask               // Starting value for each node in maskOrder: 0 for inputs, i (uncomputed) for hidden nodes
    let globalInfo         // Snapshot of the population's node counts, taken when the network is generated
    // const gpu = new GPU()

    // Generate connection matrices from genes
    function generateNetwork() {
        globalInfo = getGlobalInfo()
        
        // connections[fromNode] = list of {out, weight, enabled}, disabled genes are kept but skipped below
        let connections = new Array()
        genome.forEach(g => {
            let gene = g.split(".")
            connections[gene[1]] = [...(connections[gene[1]] ?? []), {out: parseInt(gene[2]), weight: gene[3] / 100, enabled: !!parseInt(gene[4])}]
        })

        // Order of inputs and hidden nodes in mask/matrix
        maskOrder = new Array()
        connections.forEach((c, i) => {
            if (c != null) maskOrder.push(i)
        })

        // Connection matrix
        networkMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(maskOrder.length)).map(() => 0))

        // Output matrix
        outputMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(globalInfo.outputs)).map(() => 0))

        // Populating the weights of the matrices
        connections.forEach((n, i) => {
            if (n != null) {
                let inputI = maskOrder.indexOf(i) // Get the ith node's index in the mask
                n.forEach(o => { // for each output of the node
                    if (o.enabled) { // If the connection is enabled
                        if (o.out < globalInfo.outputs) { // If an output node
                            outputMatrix[inputI][o.out] = o.weight
                        } else { // Otherwise must be a hidden node
                            // A hidden node with no outgoing connections isn't in maskOrder, indexOf gives -1
                            // and the weight is dropped. That's fine, such a node can't affect the outputs
                            networkMatrix[inputI][maskOrder.indexOf(o.out)] = o.weight
                        }
                    }
                })
            }
        })

        // Set mask
        // All numbers represented by [real, imaginary]
        mask = maskOrder.map((v) => {
            if (v < (globalInfo.outputs + globalInfo.inputs)) return gpuMult ? [0, 0] : 0
            return gpuMult ? [0, 1] : complex('i')
        })

        return {
            networkMatrix,
            outputMatrix,
            maskOrder,
            mask
        }
    }

    // Accept an input state and return the networks decision
    // All numbers represented by [real, imaginary] if using gpu
    function execute(inputs) {
        // Add initial inputs to mask
        // mI is the node's position in the input array. Hidden nodes give mI >= the number of inputs, so they're
        // skipped, but only if getInput() returns exactly config.Inputs values. A longer array would overwrite
        // hidden nodes with input values
        let tmpMask = [...mask]
        for (let i = 0; i < mask.length; i++) { // TODO: use slice
            let mI = maskOrder[i] - globalInfo.outputs
            if (mI < inputs.length) {
                gpuMult ? tmpMask[i][0] = inputs[mI] : tmpMask[i] = inputs[mI]
            }
        }

        // Initial pass, resolves the hidden nodes fed only by inputs
        let product = multiply([tmpMask], networkMatrix)
        tmpMask = activateAndRemask(product, tmpMask)
        let passes = 0  // TODO: Look into detecting cycles
        // All subsequent passes, each one resolves the next layer of hidden nodes.
        // An acyclic network needs at most one pass per node, so hitting the limit means there's a cycle
        while (stillImaginary(tmpMask) && passes < tmpMask.length) {
            passes += 1
            product = multiply([tmpMask], networkMatrix)
            tmpMask = activateAndRemask(product, tmpMask)
        }

        if (passes >= tmpMask.length) {
            // Lets use our imagination
            // Stuck on a cycle: activate the remaining nodes using only the real part of their sums
            tmpMask = activateAndRemask(product.map(p => gpuMult ? [p[0], 0] : p?.re ?? 0), tmpMask)
        }

        // Get final output, add bias, and run through activation function
        let output = multiply([tmpMask], outputMatrix)
        let activatedOutput = outputActivation(output.map((v) => (gpuMult ? v[0] : v) + bias))

        return decision(activatedOutput)
    }

    // Use gpu.js to run in parallel if gpu available
    // [real, imaginary]
    function multiply(mask, connections) {
        if (connections.length == 0) return []
        if (gpuMult) {
            let length = connections.length
            let width = connections[0].length
            let gpuMultiply = gpu.createKernel(function(m, c, l) {
                let sum = [0, 0]
                // thread.y is y pos in output
                // thread.x is x pos in output
                for (let i = 0; i < l; i++) {
                    // Real
                    sum[0] += m[this.thread.y][i][0] * c[i][this.thread.x]
                    // Imaginary
                    sum[1] += m[this.thread.y][i][1] * c[i][this.thread.x]
                }
                return sum
            }).setOutput([width, 1])

            return gpuMultiply(mask, connections, length)[0].map(v => [v[0], v[1]])
        } else {
            return mult(mask[0], connections)
        }
    }

    // Activate non-imaginary results and update mask
    // [real, imaginary]
    // delta is each node's weighted input sum. Only nodes that were still uncomputed (imaginary) and now
    // have a purely real sum are activated, inputs and already computed nodes keep their values
    function activateAndRemask(delta, old) {
        let newM = [...old]
        for (let i = 0; i < delta.length; i++) {
            if (gpuMult) {
                if (old[i][1] != 0) { // Old mask value is imaginary
                    if (delta[i][1] == 0) { // New value is real
                        newM[i] = [activation(delta[i][0] + bias), 0]
                    }
                }
            } else {
                if (typeof(old[i]) == "object") {
                    if (typeof(delta[i]) == "number") {
                        newM[i] = activation(delta[i] + bias)
                    } else if (typeof(delta[i]) == "object" && delta[i].im == 0) {
                        newM[i] = activation(delta[i].re + bias)
                    }
                }
            }
        }
        return newM
    }

    // Checks if mask still has any imaginary values
    function stillImaginary(mask) {
        for (let i = 0; i < mask.length; i++) {
            if (gpuMult) {
                if (mask[i][1] != 0) return true
            } else {
                if (typeof(mask[i]) == "object") return true
            }
        }
        return false
    }

    // Return the index of output with the greatest probability of success
    // 0 = straight, 1 = turn right, 2 = turn around, 3 = turn left (relative to pacman's direction, see game.js)
    function decision(outputs)
    {
        let decision = 0
        for(let i = 0; i < 4; i++)
        {
            if(outputs[i] > outputs[decision]){ decision = i }
        }
        return decision
    }

    // Mutates the structure of the network
    // Split defines the probability of adding a node over adding a connection
    // ex: .5 -> 50/50 chance of either, .7 -> 70 (adding a node) / 30 (adding a connection)
    function mutateStructure(rate, split, factor, addInnovations)
    {
        if (Math.random() < rate) {
            let gInfo = getGlobalInfo()
            let { connectedNodes, inputs, outputs } = getConnectionInfo(gInfo)
            let calculatedSplit = split < 0 ? getAdjustedSplit(inputs, outputs) * factor : split

            if (Math.random() < calculatedSplit) { // If less than the split add a node
                let usableGenome = genome.filter(gene => parseInt(gene.split(".")[0]) > protectedInnovations)
                if (usableGenome.length == 0) return
                
                let dGInfo = addInnovations(2, 1) // Update global info
                let newNode = gInfo.outputs + gInfo.inputs + dGInfo.hidden - 1
                let dna = usableGenome[Math.floor(Math.random() * usableGenome.length)].split(".") // Select random connection/gene to split
                dna[4] = '0' // Disable old gene

                // New genes to connect old input -> new node -> old output
                let g1 = `${dGInfo.innovations - 1}.${dna[1]}.${newNode}.100.1`, 
                    g2 = `${dGInfo.innovations}.${newNode}.${dna[2]}.${dna[3]}.1`;
                
                // Update genome
                genome = genome.map((gene) => gene.split(".")[0] == dna[0] ? dna.join(".") : gene)
                genome.push(g1, g2)
            } else { // Add connection
                let weight = Math.floor(Math.random() * 201) - 100

                // Find input and output nodes that aren't already connected
                let attempts = 0
                let maxAttempts = inputs.length * outputs.length // Total possible connections
                let input = inputs[Math.floor(Math.random() * inputs.length)]
                let output = outputs[Math.floor(Math.random() * outputs.length)]
                while (alreadyConnected(input, output, connectedNodes) && attempts < maxAttempts) {
                    input = inputs[Math.floor(Math.random() * inputs.length)]
                    output = outputs[Math.floor(Math.random() * outputs.length)]
                    attempts++
                }

                // If network isn't already fully connected
                if (attempts < maxAttempts) {
                    let dGInfo = addInnovations(1, 0) // Update global info
                    let gene = `${dGInfo.innovations}.${input}.${output}.${weight}.1`
                    // Update genome
                    genome.push(gene)
                }
            }
        }
    }

    // Get connections and possible inputs and outputs for new connections
    function getConnectionInfo(gInfo) {
        // Get existing connections so we don't duplicate
        // Possible input and outputs are selected from existing nodes in the network
        // Nodes ordered as ...outputs, ...inputs, ...hidden
        let connectedNodes = []
        let inputs = Array.apply(null, Array(gInfo.inputs)).map((v, i) => i + gInfo.outputs)
        let outputs = Array.apply(null, Array(gInfo.outputs)).map((v, i) => i)

        genome.forEach((v) => {
            let dna = v.split(".")
            let i = parseInt(dna[1]), o = parseInt(dna[2])
            inputs.push(i >= gInfo.outputs ? i : -1, o >= gInfo.outputs ? o : -1)
            outputs.push((i < gInfo.outputs || i >= gInfo.outputs + gInfo.inputs) ? i : -1, 
                            (o < gInfo.outputs || o >= gInfo.outputs + gInfo.inputs) ? o : -1)
            if (!!parseInt(dna[4])) {
                connectedNodes[i] = [...(connectedNodes[i] ?? []), parseInt(o)]
            }
        })
        inputs = inputs.filter((v, i, s) => v >= 0 && s.indexOf(v) == i)
        outputs = outputs.filter((v, i, s) => v >= 0 && s.indexOf(v) == i)

        return {
            connectedNodes,
            inputs,
            outputs
        }
    }

    // Adjust the split depending on how many nodes are already connected
    function getAdjustedSplit(inputs, outputs) {
        return (genome.length/(inputs.length * outputs.length))
    }

    // Mutates the weights of the network
    // If should mutate, replaces the weight with a random value [-100,100]
    function mutateWeights(rate) {
        for (let i = 0; i <  genome.length; i++) {
            if (Math.random() < rate) {
                let dna = genome[i].split(".")
                dna[3] = `${Math.floor(Math.random() * 201) - 100}`
                genome[i] = dna.join(".")
            }
        }
    }

    // Checks if the two nodes are already connected, either a -> b or b -> a
    function alreadyConnected(a, b, connections) {
        return connections[a]?.includes(b) || connections[b]?.includes(a) || a == b
    }

    // Set the score of the network
    function setScore(sc)
    {
        score = sc
    }

    // Get the score of the network
    function getScore()
    {
        return score
    }

    // Get the id of the network
    function getId() {
        return id
    }

    // Get the genes of the network
    function getGenome() {
        return [...genome]
    }

    function getMatrices() {
        return {
            networkMatrix,
            outputMatrix,
            mask,
            maskOrder
        }
    }

    return {
        "execute" : execute,
        "setScore" : setScore,
        "getScore" : getScore,
        "getGenome" : getGenome,
        "getId" : getId,
        "mutateWeights" : mutateWeights,
        "mutateStructure" : mutateStructure,
        "generateNetwork" : generateNetwork,
        "getMatrices" : getMatrices
    }
}