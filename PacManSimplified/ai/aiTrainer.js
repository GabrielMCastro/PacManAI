import { NeuralNetwork } from "./neuralNetwork.js"

/** 
    Handles managing population of networks, reproduction, saving top networks
    Configuration:
    * SimNum
    * PopulationSize
    * MaxGens
    * WeightMutationR
    * StructureMutationR
    * StructureMutationSplit
    * SeedNumber
    * Inputs
    * Outputs
    * ActivationFunc
    * OutputActivationFunc
    * Compatibility {
        * c1
        * c2
        * c3
        * threshold 
    }
    * ReproductionPercentile
    * Bias
    * GPUMultiplication
*/
export const AITrainer = function (config)
{
    // Configured
    let simNum = config?.SimNum ?? 1
    let populationSize = config?.PopulationSize ?? 1
    let maxGenerations = config?.MaxGens ?? 1
    let wMutationR = config?.WeightMutationR ?? .25
    let sMutationR = config?.StructureMutationR ?? 1
    let sMutationSplit = config?.StructureMutationSplit ?? .5
    let seedNum = config?.SeedNumber ?? 0
    let compatibilitySpecs = {
        c1: 1,
        c2: 1,
        c3: 1,
        threshold: 1,
        ...config?.Compatibility
    }
    let repPercentile = config?.ReproductionPercentile ?? .5
    let bias = config?.Bias ?? 1
    let gpuMultiplication = config?.GPUMultiplication ?? false
    // Genome Identifier
    let inputs = config?.Inputs ?? 0
    let hidden = 0
    let outputs = config?.Outputs ?? 0
    let innovations = 0
    // Activation Functions
    let sigmoid = (x) => (1/(1 + Math.exp(-x)))
    let tanh = (x) => ((Math.exp(x) - Math.exp(-x))/(Math.exp(x) + Math.exp(-x)))
    let softmax = (vect) => {
        let sumExp = vect.reduce((curr, val) => Math.exp(val) + curr, 0)
        let x = vect.map((x) => (Math.exp(x) / sumExp))

        return x
    }
    let activation = config?.ActivationFunc ?? tanh
    let outputActivation = config?.OutputActivationFunc ?? softmax
    // -----------------------------------------------------------
    let generations = 0        // Number of generations the algorithm has been running
    let currentNet  = simNum - 1             // The current network being tested
    let maxScore = 0           // The max score of the current network
    let topNetwork             // The weights for the top network
    let generationOver = false
    let population = []  // The population of Neural Networks
    let species = [] // Population ordered into species
    let simCurrentNets = Array.apply(null, Array(simNum)).map((v, i) => i) // The current network for each simulation

    // Initialize
    init()
    
    function init() {
        // TODO: REWORK
        let seedGenes = []
        for (let i = 0; i < seedNum; i++) {
            let rawFile = new XMLHttpRequest()
            rawFile.open("GET", `http://localhost:8000/ai/seeds/net${i}.txt`, false)
            rawFile.onreadystatechange = () => {
                if(rawFile.status === 200 || rawFile.status == 0)
                {
                    let allText = rawFile.responseText;
                    let genome = allText.replace("[", "").replace("]", "")
                                        .replace(/\"/g, "").split(",")
                    seedGenes.push(genome)
                }
            }
            rawFile.send(null)
        }
        // TODO END

        // Generate networks
        let baseGenome = generateGenome()
        for(let i = 0; i < populationSize; i++)
        {
           let net = NeuralNetwork(!!seedNum ? seedGenes[i % seedNum] : [...baseGenome], bias, activation, outputActivation, `${generations}_${i}`, getGlobalInfo, gpuMultiplication)
           net.mutateWeights(1)
           net.generateNetwork()
           population.push(net)
        }
    }

    // Get the global state of the genome
    // All hidden nodes and innovations across entire population
    function getGlobalInfo() {
        return {
            inputs,
            hidden,
            outputs,
            innovations
        }
    }

    // Execute a specific sim's network with the given input
    function execute(input, sim)
    {
        return population[simCurrentNets[sim]].execute(input)
    }

    // Set the score for a specific sim's network
    function setScore(score, sim)
    {
        (score > maxScore) ? maxScore = score : null
        population[simCurrentNets[sim]].setScore(score)
    }

    // Increment current network being tested and assign to given sim
    function moveToNext(sim)
    {
        if(currentNet < (population.length - 1))
        {
            currentNet += 1
            simCurrentNets[sim] = currentNet
        } else {
            generationOver = true
        }
    }

    // Generate base genome of input*output default connections
    function generateGenome() {
        let genes = []
        for (let i = 0; i < inputs; i++) {
            for (let j = 0; j < outputs; j++) {
                innovations++
                let gene = `${innovations}.${outputs + i}.${j}.100.1`
                genes.push(gene)
            }
        }
        return genes
    }

    // Advance to next generation
    // Reset current network, max score, and networks assigned to each sim
    // Generate a new population
    function advanceGeneration() {
        generations += 1
        currentNet = simNum - 1
        maxScore = 0
        generationOver = false
        simCurrentNets = simCurrentNets.map((v, i) => i)
        generateNewPopulation()
    }

    // Generate a new population
    // * Separate into species
    // * Cull weak members
    // * Generate new population
    // * Mutate weights of new population
    // * Mutate structure of new population
    function generateNewPopulation()
    {
        let oldSpeciesRep = species.map((v) => v[Math.floor(Math.random() * v.length)]) // Representative of the old species used to speciate new population
        let newSpecies = [] // Networks separated into new species

        // Speciate entire population
        for (let i = 0; i < population.length; i++) {
            let foundSpecies = false
            for (let j = 0; j < oldSpeciesRep.length && !foundSpecies; j++) {
                if (compatibility(population[i].getGenome(), oldSpeciesRep[j], compatibilitySpecs.c1, compatibilitySpecs.c2, compatibilitySpecs.c3) < compatibilitySpecs.threshold) { // If net meets compatibility threshold of rep
                    newSpecies[j] = [...(newSpecies[j] ?? []), population[i]] // Add to species
                    foundSpecies = true
                }
            }

            // If no species found create a new species
            if (!foundSpecies) {
                newSpecies.push([population[i]])
                oldSpeciesRep.push(population[i].getGenome())
            }
        }
        // Order on score
        newSpecies.forEach(s => s.sort((a, b) => a.getScore() - b.getScore()))

        // Find fitness of each member relative to their species size
        let adjustedFitnesses = newSpecies.map(v => v.map(n => (n.getScore() / v.length)))
        // Use that to find the species distribution of the new population
        let totalFitness = adjustedFitnesses.reduce((sum, val) => val.reduce((c, v) => c + v, 0) + sum, 0)
        let reproductionDistribution = (totalFitness > 0) 
        ? adjustedFitnesses.map((val) => val.reduce((c,v) => c + v, 0) / totalFitness).map((v) => Math.round(v * populationSize))
        : adjustedFitnesses.map((v) => v.length)

        // Cull weak members
        let percentileFitnesses = adjustedFitnesses.map((v) => v[Math.round((v.length - 1) * repPercentile)])
        let reproducers = newSpecies.map((v, i) => v.filter((_, j) => adjustedFitnesses[i][j] >= percentileFitnesses[i]))

        // Generate new population
        let newPopulation = []
        for (let i = 0; i < reproducers.length; i++) {
            for (let j = 0; j < reproductionDistribution[i]; j++) {
                let net1 = reproducers[i][Math.floor(Math.random() * reproducers[i].length)]
                let net2 = reproducers[i][Math.floor(Math.random() * reproducers[i].length)]
                newPopulation.push(crossover(net1, net2, `${i}_${j}`))
            }
        }

        // Mutate weights
        newPopulation.forEach(n => n.mutateWeights(wMutationR))

        // Mutate structure
        newPopulation.forEach(n => n.mutateStructure(sMutationR, sMutationSplit, addInnovations))

        // Generate networks
        newPopulation.forEach(n => n.generateNetwork())

        // Update
        species = newSpecies.map(s => s.map(nn => nn.getGenome())).filter(s => s?.length > 0) // Filter extinct
        population = [...newPopulation]
    }

    // Increment the innovation number and hidden nodes by requested amount and return new innovation number
    function addInnovations(i, h) {
        innovations += i
        hidden += h
        return { innovations, hidden }
    }

    // Calculate compatibility between two genomes based on their excess and disjoint genes
    function compatibility(g1, g2, c1, c2, c3) {
        let N = g1.length > g2.length ? g1.length : g2.length
        let W = [0,0] // To calculate weight different [total diff, matching genes]
        let E = [0,0] // Excess genes [l,s]
        let D = [0,0] // Disjoint genes [l,s]
        let alignedGenes = alignGenes(g1, g2)
        
        for (let i = 0; i < alignedGenes.length; i++) {
            let l = alignedGenes[i]?.["l"], s = alignedGenes[i]?.["s"]
            if (!!l && !!s) { // If both have same gene
                // Update avg weight diff
                W[0] += Math.abs((l.split(".")[3] - s.split(".")[3])/100)
                W[1] += 1
                // Transfer excess genes to disjoint
                D = [D[0] + E[0], D[1] + E[1]]
                E = [0,0]
            } else if (!!l) { // Only a gene from the larger genome
                D[1] += E[1]
                E = [E[0] + 1, 0]
            } else if (!!s) { // Only a gene from the smaller genome
                D[0] += E[0]
                E= [0, E[1] + 1]
            }
        }

        let c = (((c1 * (E[0] + E[1])) + (c2 * (D[0] + D[1]))) / N) + (c3 * (W[0] / W[1]))
        return c
    }

    // Returns genes aligned on innovation number
    // Aligned[innoN] = {"l": "innoNGene", "s": "innoNGene"}
    function alignGenes(g1, g2) {
        let aligned = []
        let larger = g1.length >= g2.length ? g1 : g2
        let smaller = g1.length < g2.length ? g1 : g2

        for (let i = 0; i < larger.length; i++) {
            let x = larger[i].split(".")[0]
            aligned[x] = {...aligned[x], "l": larger[i]}

            if (i < smaller.length) {
                x = smaller[i].split(".")[0]
                aligned[x] = {...aligned[x], "s": smaller[i]}
            }
        }

        return aligned
    }

    // Crossover two nets and return child
    function crossover(net1, net2, id) {
        let larger = net1.getGenome().length >= net2.getGenome().length ? net1 : net2
        let smaller = net1.getGenome().length < net2.getGenome().length ? net1 : net2
        let lOverS = larger.getScore() >= smaller.getScore()
        let alignedGenes = alignGenes(larger.getGenome(), smaller.getGenome())
        let genes = []

        for (let i = 0; i < alignedGenes.length; i++) {
            let l = alignedGenes[i]?.["l"], s = alignedGenes[i]?.["s"]
            if (!!l && !!s) { // If both contain same gene, select random
                genes.push(Math.round(Math.random()) ? l : s)
            } else if (!!l) { // If excess/disjoint for larger
                if (lOverS) {
                    genes.push(l) // Select if larger has better fitness
                }
            } else if (!!s) { // If excess/disjoint for smaller
                if (!lOverS) {
                    genes.push(s) // Select if smaller has better fitness
                }
            }
        }

        return NeuralNetwork(genes, bias, activation, outputActivation, `${generations}_${id}`, getGlobalInfo, gpuMultiplication)
    }

    // Returns the index of the most recent network assigned to a sim
    function getNetworkAt()
    {
        return currentNet
    }

    // Returns the current generation
    function getCurrentGeneration()
    {
        return generations
    }

    // Returns the maximum number of generations
    function getMaxGeneration()
    {
        return maxGenerations
    }

    // Returns true if entire population has already executed
    function isGenerationOver() {
        return generationOver
    }

    // Returns the top score of this generation
    function getTopScore()
    {
        return maxScore
    }

    // Returns the population size
    function getPopulationSize()
    {
        return population.length
    }

    // Returns entire population of neural networks
    function getPopulation() {
        return [...population]
    }

    // Returns speciated population
    function getSpecies() {
        return [...species]
    }

    // Returns the id for a specific sim's network
    function getCurrentNetId(sim) {
        return population[simCurrentNets[sim]].getId()
    }

    // Returns the score for a specific sim's network
    function getCurrentNetScore(sim) {
        return population[simCurrentNets[sim]].getScore()
    }

    return {
        "moveToNext" : moveToNext,
        "advanceGeneration" : advanceGeneration,
        "getNetworkAt" : getNetworkAt,
        "getPopulation" : getPopulation,
        "getSpecies" : getSpecies,
        "getCurrentGeneration" : getCurrentGeneration,
        "getMaxGeneration" : getMaxGeneration,
        "isGenerationOver" : isGenerationOver,
        "execute" : execute,
        "setScore" : setScore,
        "generateNewPopulation" : generateNewPopulation,
        "crossover" : crossover,
        "getTopScore" : getTopScore,
        "getPopulationSize" : getPopulationSize,
        "getCurrentNetId" : getCurrentNetId,
        "getGlobalInfo" : getGlobalInfo,
        "getCurrentNetScore" : getCurrentNetScore
    }
}