/**
 *  A Neural Network (one member of the NEAT population)
 *
 *  Created by aiTrainer.js (init, crossover, and loading seeds) and by networkVisualizer.js, which
 *  builds a throwaway copy just to read its matrices. aiTrainer then calls mutateWeights/mutateStructure,
 *  generateNetwork, and execute once per decision while a game is running (via AI.execute in game.js).
 *
 *  Gene encoding: v.w.x.y.z - each gene is one string and represents one connection
 *      v: global innovation number of gene
 *      w: the connection's source ("from") node, i.e. the node the signal comes out of
 *      x: the connection's target ("to") node, i.e. the node the signal goes into
 *      y: weight x100, stored as an integer (to be divided by 100)
 *      z: enable bit, 1 = enabled, 0 = disabled (disabled genes stay in the genome but carry no signal)
 *  Example: "193.4.0.92.1" = innovation 193, node 4 -> node 0, weight 0.92, enabled
 *
 *  Parameters:
 *      1. genes - array of gene strings, form of [innovationN.fromNode.toNode.weight.enableBit]
 *      2. bias - constant added to every hidden node's and every output's sum before activation
 *      3. activation - activation function for hidden nodes (number -> number, tanh by default)
 *      4. outputActivation - activation for the output layer, takes and returns the whole output array (softmax by default)
 *      5. id - name of the network, only used for display ("generation_index")
 *      6. getGlobalInfo - function returning the global info of the whole population:
 *         {inputs, hidden, outputs, innovations} = number of input nodes, hidden nodes ever created,
 *         output nodes, and the latest innovation number
 *      7. gpuMult - true to multiply on the GPU with gpu.js (broken, see multiply below)
 *      8. protectedInnovations - genes with an innovation number at or below this are never split by mutateStructure
 *
 *  Returns an object of functions (execute, setScore, getScore, getGenome, getId, mutateWeights,
 *  mutateStructure, generateNetwork, getMatrices), the network's state lives in the closure.
 *
 *  Node numbering is shared across the population:
 *      outputs: 0 .. outputs-1 | inputs: outputs .. outputs+inputs-1 | hidden: after that
 *  e.g. with 4 outputs and 2 inputs: nodes 0-3 are the outputs, 4-5 the inputs, and the first hidden node
 *  ever created (by any network) is 6. A network only contains the hidden nodes that appear in its own genes.
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
 *      See execute() for the step by step version with a worked example.
 */
// NOTE: the gpu.js import (and `const gpu` below) are commented out, so the gpuMult path can't work
// import { GPU } from "gpu.js"
// math.js gives us complex numbers (complex('i') is the imaginary unit) and a matrix multiply that handles
// a mix of plain numbers and Complex objects
import {complex, multiply as mult} from "https://dev.jspm.io/mathjs";


export const NeuralNetwork = function (genes, bias, activation, outputActivation, id, getGlobalInfo, gpuMult, protectedInnovations) 
{
    let score = 0          // Fitness, set by aiTrainer (the average fitness over this network's games)
    let genome = genes     // Array of gene strings, see the encoding above. Mutations change it, generateNetwork reads it
    let networkMatrix      // [from][to] weights between input/hidden nodes, indexed by position in maskOrder.
                           // Square (maskOrder.length x maskOrder.length). Only columns of hidden nodes can be non-zero,
                           // nothing connects into an input
    let outputMatrix       // [from][output] weights from input/hidden nodes to the output nodes.
                           // maskOrder.length rows x globalInfo.outputs columns, column j is output node j
    let maskOrder          // Node numbers of every node that has an outgoing connection, in matrix order (ascending
                           // node number, so inputs first, then hidden nodes). maskOrder[k] = node number of row/column k.
                           // Nodes without one (e.g. an input that isn't connected yet) aren't in the matrices at all
    let mask               // Starting value for each node in maskOrder: 0 for inputs, i (uncomputed) for hidden nodes.
                           // A row vector, mask[k] belongs to node maskOrder[k]. execute() copies it and fills in the inputs
    let globalInfo         // Snapshot of the population's node counts, taken when the network is generated
    // const gpu = new GPU()

    // Generate connection matrices from genes
    // Turns the genome (a list of strings) into the matrices execute() multiplies with. Must be called after
    // every change to the genome (aiTrainer calls it after creating and mutating each network), otherwise
    // execute() still uses the old matrices.
    // Returns {networkMatrix, outputMatrix, maskOrder, mask} (also kept in the closure, see getMatrices)
    //
    // Steps:
    //   1. Group the genes by their source node: connections[from] = [{out, weight, enabled}, ...]
    //   2. maskOrder = every node that has at least one outgoing gene, in node number order
    //   3. Make the zero filled networkMatrix (node -> hidden node) and outputMatrix (node -> output node)
    //   4. Fill in the weights of the enabled genes (disabled genes stay 0, i.e. no connection)
    //   5. Build the starting mask: 0 for inputs, i for hidden nodes
    //
    // Worked example, 4 outputs (0-3), 2 inputs (4, 5), one hidden node 6:
    //   genes: "1.4.0.50.1" (4 -> 0, 0.5), "2.5.6.100.1" (5 -> 6, 1.0),
    //          "3.6.1.-200.1" (6 -> 1, -2.0), "4.4.6.30.0" (4 -> 6, 0.3, disabled)
    //   1. connections[4] = [{out: 0, weight: 0.5, enabled: true}, {out: 6, weight: 0.3, enabled: false}]
    //      connections[5] = [{out: 6, weight: 1, enabled: true}]
    //      connections[6] = [{out: 1, weight: -2, enabled: true}]
    //   2. maskOrder = [4, 5, 6]          (row/column 0 is node 4, 1 is node 5, 2 is node 6)
    //   3/4. networkMatrix (rows = from, columns = to)   outputMatrix (columns = outputs 0..3)
    //             4  5  6                                     0    1   2  3
    //          4 [0, 0, 0]   <- 4 -> 6 is disabled         4 [0.5,  0, 0, 0]
    //          5 [0, 0, 1]                                 5 [0,    0, 0, 0]
    //          6 [0, 0, 0]                                 6 [0,   -2, 0, 0]
    //   5. mask = [0, 0, i]
    function generateNetwork() {
        globalInfo = getGlobalInfo()
        
        // 1. Group genes by source node
        // connections[fromNode] = list of {out, weight, enabled}, disabled genes are kept but skipped below.
        // A sparse array indexed by node number (gene[1] is a string like "4", which works as an array index)
        let connections = new Array()
        genome.forEach(g => {
            let gene = g.split(".")
            connections[gene[1]] = [...(connections[gene[1]] ?? []), {out: parseInt(gene[2]), weight: gene[3] / 100, enabled: !!parseInt(gene[4])}]
        })

        // 2. Order of inputs and hidden nodes in mask/matrix
        // forEach skips the holes of the sparse array, so this lists the source nodes in ascending node number.
        // NOTE: an input with no outgoing genes isn't in maskOrder, so its value is simply ignored by execute().
        // A node whose outgoing genes are all disabled is still included, it just gets an all zero row
        maskOrder = new Array()
        connections.forEach((c, i) => {
            if (c != null) maskOrder.push(i)
        })

        // 3. Connection matrix, maskOrder.length x maskOrder.length of zeros
        // (Array.apply(null, Array(n)) makes a real array of n undefineds so .map visits every slot)
        networkMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(maskOrder.length)).map(() => 0))

        // Output matrix, maskOrder.length x outputs of zeros
        outputMatrix = Array.apply(null, Array(maskOrder.length)).map(
            () => Array.apply(null, Array(globalInfo.outputs)).map(() => 0))

        // 4. Populating the weights of the matrices
        // Output nodes have the lowest numbers, so "o.out < outputs" tells an output target from a hidden one.
        // NOTE: if two enabled genes had the same from/to pair, the later one would overwrite the earlier weight
        // (mutateStructure only avoids this for enabled genes, see alreadyConnected)
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
                            // (technically it's stored as a "-1" property on the row array, which the multiply ignores)
                            networkMatrix[inputI][maskOrder.indexOf(o.out)] = o.weight
                        }
                    }
                })
            }
        })

        // 5. Set mask
        // Node numbers below outputs + inputs are inputs (outputs never appear in maskOrder since they have no
        // outgoing genes), they start as 0 and execute() overwrites them with the input values.
        // Hidden nodes start as i, meaning "not computed yet".
        // math.js path: 0 or complex('i'). GPU path: all numbers represented by [real, imaginary], so [0, 0] or [0, 1]
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
    //
    // Called by aiTrainer.execute(input, sim), which game.js calls every time pacman has to pick a direction.
    // inputs - array of numbers from game.js getInput(), inputs[k] is the value of input node outputs + k
    // Returns 0 = straight, 1 = turn right, 2 = turn around, 3 = turn left (relative to pacman's heading, see decision)
    //
    // The idea: in a NEAT network hidden nodes can be connected in any order, so we need to compute each node
    // only after every node feeding it is computed. Normally that means sorting the graph (topological sort).
    // Instead, every node that isn't computed yet holds the imaginary unit i. Multiplying the mask (a row vector
    // of node values) by networkMatrix gives every hidden node's weighted input sum at once:
    //      sum(node) = sum over sources of value(source) * weight(source -> node)
    // A source that's still i adds weight * i, an imaginary part. So:
    //      sum has no imaginary part  -> every source of this node is already computed, the sum is final
    //      sum has an imaginary part  -> at least one source is still uncomputed, try again next pass
    // Nodes whose sum is real get activated (activation(sum + bias)) and replace their i in the mask with that
    // real value. Repeating this computes the network layer by layer in dependency order, no sort needed.
    //
    // Steps:
    //   1. Copy the mask and write the input values into the input nodes' slots
    //   2. Pass: product = mask x networkMatrix, activate the hidden nodes whose sum became real
    //   3. Repeat 2 until no i is left, at most maskOrder.length extra passes
    //   4. If the limit was hit there's a cycle: drop the imaginary parts and activate what's left
    //   5. outputs = mask x outputMatrix, + bias, through outputActivation (softmax), then pick the largest
    //
    // Worked example, inputs 4 and 5 (values a and b), hidden nodes 6 and 7:
    //   4 -> 6 (0.5), 5 -> 6 (-1), 4 -> 7 (2), 6 -> 7 (1), 7 -> output 0 (1)
    //   maskOrder = [4, 5, 6, 7], mask after step 1 = [a, b, i, i]
    //   (mask slots are positions in maskOrder, so node 6 is slot 2 and node 7 is slot 3)
    //   Pass 1: sum6 = 0.5a - b                -> real, node 6's slot becomes h6 = act(0.5a - b + bias)
    //           sum7 = 2a + 1*i                -> imaginary (6 wasn't computed when the pass started), stays i
    //           mask = [a, b, h6, i]
    //   Pass 2: sum7 = 2a + h6                 -> real, node 7's slot becomes h7 = act(2a + h6 + bias)
    //           mask = [a, b, h6, h7], nothing imaginary left, stop
    //   Output: out0 = 1 * h7, plus bias, then softmax over all outputs
    //   (the sums of input nodes come out as 0, they're ignored since inputs were never imaginary)
    //   A node's pass number is its depth: the longest path from an input to it. networkVisualizer.js uses
    //   the same trick to choose which column to draw each node in.
    //
    // Some consequences of the trick:
    //   - A hidden node with no enabled incoming connections gets a sum of 0 on the first pass, so it's
    //     resolved immediately to activation(0 + bias)
    //   - An uncomputed node's value is exactly i, so the imaginary part of a sum is exactly the sum of the
    //     weights coming from uncomputed nodes
    //   - NOTE: imaginary parts can cancel. If node 8 is fed by 6 with weight 1 and by 7 with weight -1 while
    //     both are uncomputed, sum8 = i - i = 0, which looks real. Node 8 is then activated too early, without
    //     the real values of 6 and 7 (they count as 0), and it's never corrected later
    //   - NOTE: once a node is real it's never updated again, every node is computed exactly once per call
    //   - NOTE: each pass is a full complex matrix multiply through math.js, O(passes x nodes^2), slow compared
    //     with one pass over the nodes in topological order
    //   - NOTE: nodes in a cycle (mutateStructure can create cycles) never become real. They don't behave like
    //     a real recurrent network (no memory between calls), they get fairly arbitrary values from step 4
    function execute(inputs) {
        // 1. Add initial inputs to mask
        // mI is the node's position in the input array. Hidden nodes give mI >= the number of inputs, so they're
        // skipped, but only if getInput() returns exactly config.Inputs values. A longer array would overwrite
        // hidden nodes with input values
        // NOTE: [...mask] is a shallow copy. Fine for numbers and Complex objects (they're replaced, not changed),
        // but in the GPU path tmpMask[i][0] = ... writes into the [real, imaginary] arrays shared with mask
        let tmpMask = [...mask]
        for (let i = 0; i < mask.length; i++) { // TODO: use slice
            let mI = maskOrder[i] - globalInfo.outputs
            if (mI < inputs.length) {
                gpuMult ? tmpMask[i][0] = inputs[mI] : tmpMask[i] = inputs[mI]
            }
        }

        // 2. Initial pass, resolves the hidden nodes fed only by inputs
        // product[k] is the weighted input sum of node maskOrder[k] (a number or a math.js Complex)
        let product = multiply([tmpMask], networkMatrix)
        tmpMask = activateAndRemask(product, tmpMask)
        let passes = 0  // TODO: Look into detecting cycles
        // 3. All subsequent passes, each one resolves the next layer of hidden nodes.
        // An acyclic network needs at most one pass per node, so hitting the limit means there's a cycle
        // (a pass can also resolve nothing while a cycle is stuck, it keeps going until the limit anyway)
        while (stillImaginary(tmpMask) && passes < tmpMask.length) {
            passes += 1
            product = multiply([tmpMask], networkMatrix)
            tmpMask = activateAndRemask(product, tmpMask)
        }

        // 4. Cycle fallback
        if (passes >= tmpMask.length) {
            // Lets use our imagination
            // Stuck on a cycle: activate the remaining nodes using only the real part of their sums.
            // The real part only contains the computed sources, so every uncomputed source counts as 0.
            // All remaining nodes are activated at once from the last pass's sums, so a node downstream of a
            // cycle doesn't see the values the cycle nodes get here either.
            // (Every node left at this point had a Complex sum, the ?? 0 is only for plain number entries)
            tmpMask = activateAndRemask(product.map(p => gpuMult ? [p[0], 0] : p?.re ?? 0), tmpMask)
        }

        // 5. Get final output, add bias, and run through activation function
        // output[j] = weighted sum into output node j, every mask value is real by now.
        // NOTE: the bias is added to every output, and softmax gives the same result when the same constant is
        // added to all its inputs, so on the outputs the bias has no effect.
        // NOTE: a network with no connections has empty matrices, output is [] and decision() returns 0 (straight)
        let output = multiply([tmpMask], outputMatrix)
        let activatedOutput = outputActivation(output.map((v) => (gpuMult ? v[0] : v) + bias))

        return decision(activatedOutput)
    }

    // Use gpu.js to run in parallel if gpu available
    // [real, imaginary]
    // Vector x matrix multiply used by execute().
    // mask - [rowVector], the mask wrapped in an array (a 1 x n matrix)
    // connections - networkMatrix or outputMatrix (n x m)
    // Returns the resulting row as a flat array of m values: numbers or math.js Complex objects
    // ([real, imaginary] pairs in the GPU path). An empty matrix gives []
    //
    // NOTE: the GPU path is broken. `gpu` is never defined because the gpu.js import and `new GPU()` are
    // commented out at the top, so it throws a ReferenceError. It also builds a new kernel on every call.
    // The kernel computes real and imaginary parts separately, which works because the weights are real.
    // The math.js path below is the one actually used
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
            // math.js handles vector x matrix with mixed numbers and Complex values. Any term involving a
            // Complex makes that entry a Complex, even when its imaginary part ends up 0 (e.g. i * 0), which
            // is why activateAndRemask checks .im == 0 rather than the type alone
            return mult(mask[0], connections)
        }
    }

    // Activate non-imaginary results and update mask
    // [real, imaginary]
    // delta is each node's weighted input sum. Only nodes that were still uncomputed (imaginary) and now
    // have a purely real sum are activated, inputs and already computed nodes keep their values
    // Called by execute() after every pass (and once more for the cycle fallback).
    // delta - the product of one pass, delta[k] belongs to node maskOrder[k]
    // old - the current mask
    // Returns a new mask, old isn't modified (but see the shallow copy note in execute for the GPU path)
    // In the math.js path an uncomputed node is a Complex object (typeof "object") and a computed one a number.
    // NOTE: bias is added to every hidden node, the same constant for all of them, it isn't evolved
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
    // i.e. whether some hidden node is still uncomputed. Used by execute() as the loop condition.
    // In the math.js path every uncomputed value is a Complex object and computed ones are plain numbers
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
    // outputs - the activated outputs from execute(). Only the first 4 are looked at, ties go to the lower index.
    // game.js turns this into an absolute direction with (decision + current direction) % 4
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
    //
    // Called by aiTrainer on every child of the new generation, after mutateWeights and before generateNetwork.
    // At most one structural change per call. Changes the genome only, generateNetwork must be called afterwards.
    // rate - chance that any structural mutation happens at all
    // split - chance of adding a node rather than a connection. A negative split means "dynamic": the chance is
    //         getAdjustedSplit() * factor = genome length / (possible sources x possible targets) * factor,
    //         so node additions get likelier as the network fills up with connections
    // factor - multiplier for the dynamic split (only used when split < 0)
    // addInnovations(i, h) - aiTrainer's function that bumps the global innovation counter by i and the global
    //         hidden node count by h, and returns the new {innovations, hidden}
    // Returns nothing
    //
    // Add node (classic NEAT): split an existing connection A -> B into A -> new -> B
    //   1. Pick a random gene that isn't protected (innovation > protectedInnovations)
    //   2. Reserve 2 innovation numbers and 1 hidden node number globally
    //   3. Disable the old gene, add A -> new with weight 1.0 (stored as 100) and new -> B with the old weight,
    //      so the network behaves roughly as before (apart from the activation and bias on the new node)
    //   e.g. splitting "12.4.1.-50.1" when the global counts become innovations = 31, hidden = 3
    //        (4 outputs, 6 inputs, so the new node is 4 + 6 + 3 - 1 = 12):
    //        "12.4.1.-50.0" (disabled), "30.4.12.100.1", "31.12.1.-50.1"
    // Add connection: random weight in [-1, 1], then pick random (source, target) pairs until one isn't already
    //   connected, giving up after sources x targets attempts
    //
    // NOTE: every mutation gets brand new innovation numbers. Classic NEAT gives the same structural mutation
    //   the same number within a generation, here two networks making the same split get different numbers
    //   and different hidden nodes, so crossover/speciation treat them as unrelated genes
    // NOTE: nothing checks for cycles when adding a connection (hidden -> hidden can point backwards), which is
    //   why execute() limits its passes
    function mutateStructure(rate, split, factor, addInnovations)
    {
        if (Math.random() < rate) {
            // gInfo is read before addInnovations below, so it holds the counts from before this mutation
            let gInfo = getGlobalInfo()
            let { connectedNodes, inputs, outputs } = getConnectionInfo(gInfo)
            let calculatedSplit = split < 0 ? getAdjustedSplit(inputs, outputs) * factor : split

            if (Math.random() < calculatedSplit) { // If less than the split add a node
                // 1. Only unprotected genes can be split.
                // NOTE: disabled genes aren't filtered out, so an already disabled gene can be split, which adds an
                // enabled path A -> new -> B in place of a connection that was off
                let usableGenome = genome.filter(gene => parseInt(gene.split(".")[0]) > protectedInnovations)
                if (usableGenome.length == 0) return
                
                // 2. Reserve the numbers. Hidden nodes are numbered after all outputs and inputs, and the
                // global hidden count was just incremented, so the new node is the last hidden number
                let dGInfo = addInnovations(2, 1) // Update global info
                let newNode = gInfo.outputs + gInfo.inputs + dGInfo.hidden - 1
                let dna = usableGenome[Math.floor(Math.random() * usableGenome.length)].split(".") // Select random connection/gene to split
                dna[4] = '0' // Disable old gene

                // 3. New genes to connect old input -> new node -> old output
                // g1 gets the first reserved innovation number, g2 the second
                let g1 = `${dGInfo.innovations - 1}.${dna[1]}.${newNode}.100.1`, 
                    g2 = `${dGInfo.innovations}.${newNode}.${dna[2]}.${dna[3]}.1`;
                
                // Update genome
                // Replace the old gene (matched by innovation number) with its disabled version, then add the new ones
                genome = genome.map((gene) => gene.split(".")[0] == dna[0] ? dna.join(".") : gene)
                genome.push(g1, g2)
            } else { // Add connection
                // Weight x100, an integer in [-100, 100] i.e. [-1, 1]
                let weight = Math.floor(Math.random() * 201) - 100

                // Find input and output nodes that aren't already connected
                // ("input" = source node, any input or hidden node; "output" = target node, any output or hidden node)
                // The pairs are random, so the search can give up even if a free pair still exists
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
                // (more exactly: if a free pair was found before running out of attempts)
                // NOTE: if the free pair is found on the very last attempt, attempts == maxAttempts and it's
                // discarded anyway
                if (attempts < maxAttempts) {
                    let dGInfo = addInnovations(1, 0) // Update global info
                    // e.g. "32.5.12.-37.1" = innovation 32, node 5 -> node 12, weight -0.37, enabled
                    let gene = `${dGInfo.innovations}.${input}.${output}.${weight}.1`
                    // Update genome
                    genome.push(gene)
                }
            }
        }
    }

    // Get connections and possible inputs and outputs for new connections
    // Called by mutateStructure. gInfo = the population's global info ({inputs, hidden, outputs, innovations}).
    // Returns {connectedNodes, inputs, outputs}:
    //   connectedNodes[from] = list of target node numbers of this genome's ENABLED genes from that node
    //   inputs  = possible sources: every input node, plus every hidden node that appears in this genome
    //   outputs = possible targets: every output node, plus every hidden node that appears in this genome
    // ("inputs"/"outputs" here mean connection ends, not the network's input/output layers.)
    // Hidden nodes that only appear in disabled genes count too. Hidden nodes of other networks don't.
    // e.g. 4 outputs, 2 inputs, genome ["7.4.6.100.1", "8.6.0.50.1"]:
    //   inputs = [4, 5, 6], outputs = [0, 1, 2, 3, 6], connectedNodes[4] = [6], connectedNodes[6] = [0]
    function getConnectionInfo(gInfo) {
        // Get existing connections so we don't duplicate
        // Possible input and outputs are selected from existing nodes in the network
        // Nodes ordered as ...outputs, ...inputs, ...hidden
        let connectedNodes = []
        // Start with every input node (outputs .. outputs+inputs-1) and every output node (0 .. outputs-1)
        let inputs = Array.apply(null, Array(gInfo.inputs)).map((v, i) => i + gInfo.outputs)
        let outputs = Array.apply(null, Array(gInfo.outputs)).map((v, i) => i)

        // Then add both ends of every gene where they qualify, pushing -1 as a "skip" placeholder otherwise:
        //   a possible source is any node >= outputs (an input or hidden node)
        //   a possible target is an output (< outputs) or a hidden node (>= outputs + inputs), never an input
        // The duplicates and -1s are filtered out after the loop
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
        // Drop the -1 placeholders and keep only the first copy of each node
        inputs = inputs.filter((v, i, s) => v >= 0 && s.indexOf(v) == i)
        outputs = outputs.filter((v, i, s) => v >= 0 && s.indexOf(v) == i)

        return {
            connectedNodes,
            inputs,
            outputs
        }
    }

    // Adjust the split depending on how many nodes are already connected
    // Used by mutateStructure when split < 0 (dynamic split). inputs/outputs are the possible sources and
    // targets from getConnectionInfo. Returns genome length / (sources x targets), roughly how full the network
    // is. e.g. 10 genes, 8 sources, 5 targets -> 0.25, so (with factor 1) a 25% chance of adding a node.
    // NOTE: disabled genes count towards the genome length, and the result can go above 1 (then mutateStructure
    // always adds a node)
    function getAdjustedSplit(inputs, outputs) {
        return (genome.length/(inputs.length * outputs.length))
    }

    // Random number from a normal distribution with mean 0 and standard deviation 1 (Box-Muller)
    // Turns two uniform random numbers into one normal one. 1 - Math.random() is in (0, 1], so log never gets 0.
    // Used by mutateWeights
    function gaussian() {
        return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
    }

    // Mutates the weights of the network. Each gene mutates with chance rate:
    //   90% - nudged by a normal random amount (standard deviation 20, i.e. 0.2), kept within [-300, 300] (i.e. [-3, 3])
    //   10% - replaced with a new random weight in [-100, 100] (i.e. [-1, 1])
    // Weights are stored x100 in the genes
    // Called by aiTrainer: on every child of a new generation (rate = the weight mutation rate), and when the
    // first population is created (rate 1 so every starting genome gets different weights, or .1 for seeds).
    // Changes the genome only, generateNetwork must be called afterwards. Returns nothing.
    // Disabled genes are mutated too. Small nudges fine tune a weight, the occasional full replacement lets it
    // jump somewhere new
    function mutateWeights(rate) {
        for (let i = 0; i <  genome.length; i++) {
            if (Math.random() < rate) {
                let dna = genome[i].split(".")
                if (Math.random() < .9) {
                    let w = parseInt(dna[3]) + Math.round(gaussian() * 20)
                    dna[3] = `${Math.max(-300, Math.min(300, w))}`
                } else {
                    dna[3] = `${Math.floor(Math.random() * 201) - 100}`
                }
                genome[i] = dna.join(".")
            }
        }
    }

    // Checks if the two nodes are already connected, either a -> b or b -> a
    // Used by mutateStructure to reject a candidate connection. connections = connectedNodes from
    // getConnectionInfo. Also returns true for a self loop (a == b, possible when a hidden node is picked as
    // both source and target).
    // Checking b -> a as well stops direct two node loops, but longer cycles (a -> b -> c -> a) can still form.
    // NOTE: only enabled genes are in connections, so a pair whose gene is disabled can get a second gene
    // with a new innovation number
    function alreadyConnected(a, b, connections) {
        return connections[a]?.includes(b) || connections[b]?.includes(a) || a == b
    }

    // Set the score of the network (aiTrainer sets it to the network's fitness)
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
    // Returns a copy, so changing the returned array doesn't change the network
    function getGenome() {
        return [...genome]
    }

    // Returns the matrices built by the last generateNetwork() call (undefined before the first call).
    // Used by networkVisualizer.js to lay out the network.
    // NOTE: these are the live arrays, not copies, the visualizer modifies maskOrder in place (on its own
    // throwaway network)
    function getMatrices() {
        return {
            networkMatrix,
            outputMatrix,
            mask,
            maskOrder
        }
    }

    // Public interface, everything else stays private to this closure
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