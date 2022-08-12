/**
 *  A Neural Network module
 * 
 *  Parameters:
 *      1. array - index represents layer number, and value represents layer size
 *      2. bias
 *      3. activation function
 */

export const NeuralNetwork = function (layers, bias, activation, id) 
{

    /**
     * (y, x)
     * ex:
     * weights[0] = weights for layer 1. A (y, x) matrix containing the weights for each connection
     * weights[1] = weights for layer 2. A (y, x) matrix containing the weights for each connection
     * weights[2] = weights for layer 3. A (y, x) matrix containing the weights for each connection
     * weights[n - 1] = weights for the output layer. A (y, x) matrix containing the weights for each connection
     */
    var weights = new Array()
    var output = new Array(layers[layers.length - 1])    // The output of the network.
    var score = 0                                        // The score for the network

    function execute(input)
    {
        var currLayer = input
        for(var i = 0; i < (layers.length - 1); i++)
        {
            currLayer = executeLayer(weights[i], currLayer)
        }
       output = currLayer
    }

    function executeLayer(weights, layer)
    {
        var result = new Array()
        for(var i = 0; i < weights.length; i++)
        {
            var sum = 0
            for(var j = 0; j < weights[i].length; j++)
            {
                sum += (weights[i][j] * layer[j])
            }
            sum -= bias;
            result[i] = activation(sum)
        }
        return result
    }

    function getDecision()
    {
        var decision = 0
        for(var i = 0; i < 4; i++)
        {
            if(output[i] > output[decision]){ decision = i }
        }
        return decision
    }

    // Generates weights for each connection in the network
    function generateWeights()
    {
        var x,y;
        for(var i = 0; i < (layers.length - 1); i++)
        {
            weights.push(new Array())

            x = layers[i]
            y = layers[i + 1]

            for(var j = 0; j < y; j++)
            {
                weights[i].push(new Array)
                for(var n = 0; n < x; n++)
                {
                    weights[i][j].push((Math.random() * 2) - 1)
                }
            } 
        }
    }

    function setWeights(inweights)
    {
        weights = inweights
    }

    function getWeights()
    {
        return weights
    }

    function getOutput()
    {
        return output
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

    function getLayers() {
        return layers
    }

    function getId() {
        return id
    }

    function mutateWeights(mutationrate)
    {
        if(Math.random() < mutationrate)
        {
            for(var i = 0; i < weights.length; i++)
            {
                for(var j = 0; j < weights[i].length; j++)
                {
                    for(var k = 0; k < weights[i][j].length; k++)
                    {
                        if(Math.random() < mutationrate)
                        {
                            var mutation = (Math.random() * 2) - 1
                            weights[i][j][k] = weights[i][j][k] * mutation
                        }
                    }
                }
            }
        }
    }

    return {
        "execute" : execute,
        "getDecision" : getDecision,
        "generateWeights" : generateWeights,
        "getWeights" : getWeights,
        "setWeights" : setWeights,
        "getOutput" : getOutput,
        "setBias" : setBias,
        "getBias" : getBias,
        "setScore" : setScore,
        "getScore" : getScore,
        "getLayers" : getLayers,
        "mutateWeights" : mutateWeights,
        "getId" : getId,
    }
}