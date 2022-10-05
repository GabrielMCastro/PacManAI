/**
 *  A Neural Network module
 * 
 *  Parameters:
 *      1. array - index represents layer number, and value represents layer size
 *      2. bias
 *      3. activation function
 */

export const NeuralNetwork = function (genes, bias, activation, outputActivation, id) 
{
    var score = 0                                        // The score for the network
    var hex2bin = (hex) => (parseInt(hex, 16).toString(2)).padStart(28, 0)
    var bin2hex = (bin) => (parseInt(bin, 2).toString(16)).padStart(7, 0)
    var replaceAt = (i, s, r) => s.slice(0, i) + r + s.slice(i + r.length)
    var hexRef = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
    var network
    var genome = genes
    var levels = 1
    var canvas
    var INPUT_NUM = 81
    var MAX_INT_NUM = 255
    var OUTPUT_NUM = 4
    var DIV_CONST = 535

    generateNetwork()

    function generateNetwork() {
        initNetwork()
        levels = 1
        var binGenes = genome.map((g) => hex2bin(g))
        for (var i = 0; i < binGenes.length; i++) {
            var inputBin = binGenes[i].slice(0, 9)
            var outputBin = binGenes[i].slice(9, 18)
            var weightBin = binGenes[i].slice(18)

            // Parse input neuron of connection
            var extIn = parseInt(inputBin[0])
            var inNeuron = parseInt(inputBin.slice(1), 2) % MAX_INT_NUM
            if (extIn) {
                inNeuron = inNeuron % INPUT_NUM // Number of neurons on input layer
            } else {
                inNeuron += INPUT_NUM
            }

            // Parse output neuron of connection
            var extOut = parseInt(outputBin[0])
            var outNeuron = parseInt(outputBin.slice(1), 2) % MAX_INT_NUM
            if (extOut) {
                outNeuron = INPUT_NUM + MAX_INT_NUM + (outNeuron % OUTPUT_NUM) // Number of neurons on output layer
            } else {
                outNeuron += INPUT_NUM
            }

            // Parse weight
            var sign = parseInt(weightBin[0])
            var weight = (parseInt(weightBin.slice(1), 2) / DIV_CONST) * ((sign == 1) ? 1 : -1)

            if (inNeuron < outNeuron) {
                network[inNeuron].downstream.push({
                    id: outNeuron,
                    weight: weight
                })
                network[outNeuron].upstream.push(inNeuron)
                if(network[inNeuron].level == network[outNeuron].level) {
                    network[outNeuron].level += 1
                }
                // For rendering purposes
                if (network[outNeuron].level == levels) levels++
            }
        }

        // let paths = getUpstreamPaths()
        // console.log(paths)
        // console.log(genome)
        // console.log(getVisualization())
    }

    function initNetwork() {
        network = new Array()
        for(var i = 0; i < (INPUT_NUM + MAX_INT_NUM + OUTPUT_NUM); i++) {
            network.push({
                downstream: [],
                upstream: [],
                value: 0,
                level: 0,
                on: false
            })
        }
    }

    function getVisualization() {
        return {
            levels: levels,
            visual: network
        }
    }

    // function renderCanvas() {
    //     var h = INPUT_NUM * 15 
    //     var w = levels * 20
    //     canvas.setAttribute("height", h + "px");
    //     canvas.setAttribute("width", w + "px");
    // }

    function setCanvas(cvs) {
        canvas = cvs
    }

    function inputValues(inputs) {
        for(var i = 0; i < inputs.length; i++) {
            network[i].value = inputs[i]
        }
    }

    function execute(inputs) {
        inputValues(inputs)
        for(var i = 0; i < (network.length - OUTPUT_NUM); i++) {
            network[i].value = activation(network[i].value + bias)
            network[i].on = true
            for (var j = 0; j < network[i].downstream.length; j++) {
                var down = network[i].downstream[j]

                // Neurons should just reset themselves after executing
                // if (network[down.id].on) {
                //     network[down.id].on = false
                //     network[down.id].value = 0
                // }
                // if (network[i].value > 0) {
                
                // }

                network[down.id].value += network[i].value * down.weight
            }
            network[i].value = 0 // Reset output for next decision
        }

        var outputs = []
        for (var i = 0; i < OUTPUT_NUM; i++) {
            var x = (network.length - 1) - i
            outputs.push(network[x].value + bias)
            network[x].value = 0 // Reset output for next decision
        }

        var activatedOutput = outputActivation(outputs)

        // console.log({ outputs, activatedOutput, sum: activatedOutput.reduce((curr, val) => curr + val, 0)})
        // console.log(network)

        return decision(activatedOutput)
    }

    function getUpstreamPaths() {
        var paths = []
        for (var i = 0; i < OUTPUT_NUM; i++) {
            var x = (network.length - 1) - i
            paths.push(getUpstream(network[x], x))
        }

        return paths
    }

    // Follows all upstream paths of a neuron to an input 
    function getUpstream(neuron, id) {
        if (neuron.upstream.length == 0) {
            if (id < INPUT_NUM) {
                return id
            } else {
                return false
            }
        }
        
        var path = []
       for (var i = 0; i < neuron.upstream.length; i++) {
           var upId = neuron.upstream[i]
           var upPath = getUpstream(network[upId], upId)
           if (upPath !== false) path.push(upPath)
       }

       if (path.length == 0) return false
       return {
           at: id,
           up: path
       }
    }

    function decision(outputs)
    {
        var decision = 0
        for(var i = 0; i < 4; i++)
        {
            if(outputs[i] > outputs[decision]){ decision = i }
        }
        return decision
    }

    function setBias(inbias)
    {
        bias = inbias
    }

    function getBias()
    {
        return bias
    }

    function setScore(sc)
    {
        score = sc
    }

    function getScore()
    {
        return score
    }

    function getId() {
        return id
    }

    function setGenome(genes) {
        genome = genes
        generateNetwork()
    }

    function mutateGenome(mutationRate)
    {
        if (false){//Math.random < (1 / genome.length())) { // Add gene
            var gene = ""
            for (var j = 0; j < 7; j++) {
                gene += hexRef[Math.floor(Math.random() * 16)]
            }
            genome.push(gene)
        } else { // Mutate existing genes
            var binGenes = genome.map((g) => hex2bin(g))
            var binGenes = binGenes.map((g) => {
                if (Math.random() < mutationRate) {
                    var i = Math.floor(Math.random() * (g.length - 1))
                    var mutatedG = replaceAt(i, g, g[i] == "0" ? "1" : "0")

                    return mutatedG
                }
                return g
            })
            // console.log(binGenes)
            genome = binGenes.map((g) => bin2hex(g))
            // console.log(genome)
        }
    }

    function getGenome() {
        return genome
    }

    return {
        "execute" : execute,
        "setBias" : setBias,
        "getBias" : getBias,
        "setScore" : setScore,
        "getScore" : getScore,
        "mutateGenome" : mutateGenome,
        "getGenome" : getGenome,
        "getId" : getId,
        "getVisualization" : getVisualization,
        "setCanvas" : setCanvas,
        "getUpstreamPaths" : getUpstreamPaths,
        "hex2bin" : hex2bin,
        "bin2hex" : bin2hex
    }
}