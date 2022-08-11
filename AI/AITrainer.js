class AITrainer 
{
    constructor()
    {
        this.populationsize = 50       // The size of the population
        this.population = new Array()   // The population of Neural Networks
        for(var i = 0; i < this.populationsize; i++)
        {
            this.population.push(new NeuralNetwork(
                                                [418, 150, 100, 50, 25, 12, 4],
                                                1,
                                                (x) =>
                                                {
                                                    return (1/(1 + Math.exp(x)))
                                                }))
            this.population[i].generateWeights()
        }
        this.generations = 0        // Number of generations the algorithm has been running
        this.maxgenerations = 100   // Max number of generations I want to run
        this.mutationRate = .01    // Mutation rate of the algorithms
        this.popat  = 0             // The current network being tested
        this.maxscore = 0           // The max score of the current network
        this.generationalPool = new Array()  // The pool of networks that the new generation will be from
        this.topnetwork             // The weights for the top network
    }

    moveToNext()
    {
        if(this.popat < (this.populationsize - 1))
        {
            this.popat += 1
        }else
        {
           // this.evaluate()
            console.log('moving on')
            this.topnetwork = this.getTopNetwork()
            this.naturalSelection()
            this.generateNewPopulation()
            this.generations += 1
            this.popat = 0
            this.maxscore = 0
        }
    }

    getPopulationAt()
    {
        return this.popat
    }

    getGenerationAt()
    {
        return this.generations
    }

    getMaxGeneration()
    {
        return this.maxgenerations
    }

    // Executes the network currently being tested with the given input data
    execute(input)
    {
        this.population[this.popat].execute(input)
    }

    // Retrieves the decision made by the network
    getDecision()
    {
        return this.population[this.popat].getDecision()
    }

    setScore(score)
    {
        (score > this.maxscore) ? this.maxscore = score : null
        this.population[this.popat].setScore(score)
    }

    // Generate a new breeding sample
    naturalSelection()
    {
        this.generationalPool.length = 0

        for(var i = 0; i < this.populationsize; i++)
        {
            var normalizedfitness = (this.population[i].getScore()/this.maxscore)
            var n = Math.floor(normalizedfitness * 100)
            for(var j = 0; j < n; j++)
            {
                this.generationalPool.push(i)
            }
        }
    }

    // Generate a new population from the breeding sample
    generateNewPopulation()
    {
        var newpop = new Array()
        
        for(var i = 0; i < this.populationsize; i++)
        {
            newpop.push(this.population[this.generationalPool[Math.floor(Math.random() * this.generationalPool.length)]])
            newpop[i].mutateWeights(this.mutationRate)
        }

        this.population = newpop
    }

    getTopScore()
    {
        return this.maxscore
    }

    getPopulationSize()
    {
        return this.populationsize
    }

    getTopNetwork()
    {
        var maxscore = 0
        var topnetwork = 0
        for(var i = 0; i < this.population.length; i++)
        {
            if(this.population[i].getScore() > maxscore)
            {
                maxscore = this.population[i].getScore()
                topnetwork = i
            }
        }

        this.maxscore = maxscore
        return this.population[topnetwork].getWeights()
    }

    saveTopNetwork(fileName, contentType) {
        var a = document.createElement("a");
        var content = JSON.stringify(this.topnetwork)
        var file = new Blob([content], {type: contentType});
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
    }
}