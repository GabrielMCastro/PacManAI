/**
 *  A Neural Network module
 *  User can specify:
 *      1. # of layers
 *      2. # of nodes per layer
 *      3. Bias
 *      4. Activation function
 */

class NeuralNetwork 
{
    /**
     *  Parameters:
     *      1. array - index represents layer number, and value represents layer size
     *      2. bias
     *      3. activation function
     */
    constructor(layers, bias, activationfunction)
    {
        this.layers = layers
        this.activationfunction = activationfunction
        /**
         * (y, x)
         * ex:
         * weights[0] = weights for layer 1. A (y, x) matrix containing the weights for each connection
         * weights[1] = weights for layer 2. A (y, x) matrix containing the weights for each connection
         * weights[2] = weights for layer 3. A (y, x) matrix containing the weights for each connection
         * weights[n - 1] = weights for the output layer. A (y, x) matrix containing the weights for each connection
         */
        this.weights = new Array()
        this.output = new Array(this.layers[this.layers.length - 1])    // The output of the network.
        this.bias = bias                                                   // The bias for the network
        this.score = 0                                                     // The score for the network
    }

    execute(input)
    {
        var currLayer = input
        for(var i = 0; i < (this.layers.length - 1); i++)
        {
            currLayer = this.executeLayer(this.weights[i], currLayer)
        }
       this.output = currLayer
    }

    executeLayer(weights, layer)
    {
        var result = new Array()
        for(var i = 0; i < weights.length; i++)
        {
            var sum = 0
            for(var j = 0; j < weights[i].length; j++)
            {
                sum += (weights[i][j] * layer[j])
            }
            sum -= this.bias;
            result[i] = this.activationfunction(sum)
        }
        return result
    }

    getOutput()
    {
        return this.output
    }

    getDecision()
    {
        var decision = 0
        for(var i = 0; i < 4; i++)
        {
            if(this.output[i] > this.output[decision]){ decision = i }
        }
        return decision
    }

    // Generates weights for each connection in the network
    generateWeights()
    {
        var x,y;
        for(var i = 0; i < (this.layers.length - 1); i++)
        {
            this.weights.push(new Array())

            x = this.layers[i]
            y = this.layers[i + 1]

            for(var j = 0; j < y; j++)
            {
                this.weights[i].push(new Array)
                for(var n = 0; n < x; n++)
                {
                    this.weights[i][j].push((Math.random() * 2) - 1)
                }
            } 
        }
    }

    setWeights(inweights)
    {
        this.weights = inweights
    }

    getWeights()
    {
        return this.weights
    }

    getOutput()
    {
        return this.output
    }

    setBias(inbias)
    {
        this.bias = inbias
    }

    getBias()
    {
        return this.bias
    }

    setScore(sc)
    {
        this.score = sc
    }

    getScore()
    {
        return this.score
    }

    mutateWeights(mutationrate)
    {
        if(Math.random() < mutationrate)
        {
            for(var i = 0; i < this.weights.length; i++)
            {
                for(var j = 0; j < this.weights[i].length; j++)
                {
                    for(var k = 0; k < this.weights[i][j].length; k++)
                    {
                        if(Math.random() < mutationrate)
                        {
                            if(Math.random() < .5)
                            {
                                this.weights[i][j][k] = ((Math.random() * 2) - 1)
                            }else
                            {
                                this.weights[i][j][k] = (this.weights[i][j][k] * 1.05)
                            }
                        }
                    }
                }
            }
        }
    }
}