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
 */
 import {complex, multiply} from "https://dev.jspm.io/mathjs";


export const NeuralNetwork = function (genes, bias, activation, outputActivation, id, getGlobalInfo) 
{
    let score = 0
    let genome = genes
    let networkMatrix
    let outputMatrix
    let mask

    // Generate connection matrices from genes
    function generateNetwork() {
        let gInfo = getGlobalInfo()
        
        let connections = new Array()
        genome.forEach(g => {
            let gene = g.split(".")
            connections[gene[1]] = [...(connections[gene[1]] ?? []), {out: parseInt(gene[2]), weight: gene[3] / 100, enabled: !!parseInt(gene[4])}]
        })

        // Order of inputs and hidden nodes in mask/matrix
        let maskOrder = new Array()
        connections.forEach((c, i) => {
            if (c != null) maskOrder.push(i)
        })

        // Connection matrix
        networkMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(maskOrder.length)).map(() => 0))

        // Output matrix
        outputMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(gInfo.outputs)).map(() => 0))

        // Populating the weights of the matrices
        connections.forEach((n, i) => {
            if (n != null) {
                let inputI = maskOrder.indexOf(i) // Get the ith node's index in the mask
                n.forEach(o => { // for each output of the node
                    if (o.enabled) { // If the connection is enabled
                        if (o.out < gInfo.outputs) { // If an output node
                            outputMatrix[inputI][o.out] = o.weight
                        } else { // Otherwise must be a hidden node
                            networkMatrix[inputI][maskOrder.indexOf(o.out)] = o.weight
                        }
                    }
                })
            }
        })

        // Set mask
        mask = maskOrder.map((v) => {
            if (v < (gInfo.outputs + gInfo.inputs)) return 0
            return complex('i')
        })

        return {
            networkMatrix,
            outputMatrix,
            mask
        }
    }

    // Accept an input state and return the networks decision
    function execute(inputs) {
        // Add initial inputs to mask
        let tmpMask = [...mask]
        for (let i = 0; i < inputs.length; i++) { // TODO: use slice
            tmpMask[i] = inputs[i]
        }

        // Initial pass
        let product = multiply(tmpMask, networkMatrix)
        tmpMask = activateAndRemask(product, tmpMask)
        // All subsequent passes
        while (stillImaginary(tmpMask)) {
            product = multiply(tmpMask, networkMatrix)
            tmpMask = activateAndRemask(product, tmpMask)
        }


        // Get final output, add bias, and run through activation function
        let output = multiply(tmpMask, outputMatrix)
        let activatedOutput = outputActivation(output.map((v) => v + bias))

        return decision(activatedOutput)
    }

    // Activate non-imaginary results and update mask
    function activateAndRemask(delta, old) {
        let newM = [...old]
        for (let i = 0; i < delta.length; i++) {
            if (typeof(old[i]) == "object") {
                if (typeof(delta[i]) == "number") {
                    newM[i] = activation(delta[i] + bias)
                } else if (typeof(delta[i]) == "object" && delta[i].im == 0) {
                    newM[i] = activation(delta[i].re + bias)
                }
            }
        }
        return newM
    }

    // Checks if mask still has any imaginary values
    function stillImaginary(mask) {
        for (let i = 0; i < mask.length; i++) {
            if (typeof(mask[i]) == "object") return true
        }
        return false
    }

    // Return the index of output with the greatest probability of success
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
    function mutateStructure(rate, split, addInnovations)
    {
        if (Math.random() < rate) {
            if (Math.random() < split) { // If less than the split add a node
                let gI = Math.floor(Math.random() * genome.length) // Select random connection/gene to split
                let gInfo = getGlobalInfo()
                let dGInfo = addInnovations(2, 1) // Update global info
                let newNode = gInfo.outputs + gInfo.inputs + dGInfo.hidden - 1
                let dna = genome[gI].split(".")
                dna[4] = 0 // Disable old gene
                // New genes to connect old input -> new node -> old output
                let g1 = `${dGInfo.innovations - 1}.${dna[1]}.${newNode}.100.1`, 
                    g2 = `${dGInfo.innovations}.${newNode}.${dna[2]}.${dna[3]}.1`;
                
                // Update genome
                genome[gI] = dna.join(".")
                genome.push(g1, g2)
            } else { // Add connection
                let gInfo = getGlobalInfo()
                let weight = Math.floor(Math.random() * 201) - 100

                // Get existing connections so we don't duplicate
                // Possible input and outputs are selected from existing nodes in the network
                // Nodes ordered as ...outputs, ...inputs, ...hidden
                let connectedNodes = []
                let inputs = []
                let outputs = []
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
        return genome
    }

    return {
        "execute" : execute,
        "setScore" : setScore,
        "getScore" : getScore,
        "getGenome" : getGenome,
        "getId" : getId,
        "mutateWeights" : mutateWeights,
        "mutateStructure" : mutateStructure,
        "generateNetwork" : generateNetwork
    }
}