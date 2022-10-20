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

        //TESTING
        let tg1 = [
            "1.4.0.-87.1",
            "2.4.1.53.1",
            "3.4.2.97.1",
            "4.4.3.-71.1",
            "5.5.0.17.1",
            "6.5.1.41.0",
            "7.5.2.-36.1",
            "8.5.3.-96.1",
            "9.6.0.61.1",
            "10.6.1.-75.1",
            "11.6.2.-94.1",
            "12.6.3.-71.0",
            "13.7.0.-60.1",
            "14.7.1.-2.1",
            "15.7.2.46.1",
            "16.7.3.-74.0",
            "17.8.0.100.1",
            "18.8.1.-87.1",
            "19.8.2.24.1",
            "20.8.3.23.0",
            "21.9.0.-36.1",
            "22.9.1.95.1",
            "23.9.2.83.1",
            "24.9.3.-8.0",
            "25.10.0.-90.0",
            "26.10.1.73.1",
            "27.10.2.-72.1",
            "28.10.3.-17.1",
            "29.11.0.55.0",
            "30.11.1.-30.1",
            "31.11.2.-67.1",
            "32.11.3.-58.1",
            "33.12.0.-24.1",
            "34.12.1.-46.1",
            "35.12.2.78.1",
            "36.12.3.-54.1",
            "37.13.0.25.1",
            "38.13.1.-98.1",
            "39.13.2.68.1",
            "40.13.3.60.1",
            "45.8.16.45.1",
            "46.16.3.-26.1",
            "91.4.37.-64.1",
            "92.37.3.-25.1",
            "144.10.59.-46.1",
            "145.59.2.-94.1",
            "203.13.16.-86.1",
            "257.9.94.-93.0",
            "258.94.3.9.1",
            "334.4.120.36.1",
            "335.120.37.100.1",
            "384.10.136.100.1",
            "385.136.0.35.1",
            "485.13.171.-14.1",
            "486.171.1.42.1",
            "550.12.193.100.1",
            "551.193.1.-46.1",
            "583.5.94.87.1",
            "657.13.229.100.1",
            "658.229.171.95.1",
            "708.9.247.94.1",
            "709.247.94.91.1",
            "760.193.261.-42.1",
            "761.261.1.93.0",
            "828.193.37.-47.1",
            "881.16.247.-81.1",
            "939.6.317.100.1",
            "940.317.3.88.1",
            "986.12.261.41.1",
            "1052.11.357.100.1",
            "1053.357.0.-28.1",
            "1110.9.374.100.1",
            "1111.374.3.-8.1",
            "1178.16.37.-22.1",
            "1233.261.420.100.1",
            "1234.420.1.93.1"
        ]
        let tg2 = [
            "1.4.0.73.1",
            "2.4.1.42.1",
            "3.4.2.16.1",
            "4.4.3.-83.1",
            "5.5.0.-26.1",
            "6.5.1.-41.1",
            "7.5.2.-86.1",
            "8.5.3.-11.1",
            "9.6.0.85.1",
            "10.6.1.58.1",
            "11.6.2.-16.1",
            "12.6.3.68.1",
            "13.7.0.91.1",
            "14.7.1.73.1",
            "15.7.2.-57.1",
            "16.7.3.-2.1",
            "17.8.0.72.0",
            "18.8.1.-61.1",
            "19.8.2.-18.1",
            "20.8.3.41.1",
            "21.9.0.91.1",
            "22.9.1.-4.1",
            "23.9.2.26.1",
            "24.9.3.-10.1",
            "25.10.0.8.0",
            "26.10.1.-84.1",
            "27.10.2.58.1",
            "28.10.3.1.1",
            "29.11.0.66.1",
            "30.11.1.42.1",
            "31.11.2.38.0",
            "32.11.3.-26.1",
            "33.12.0.13.1",
            "34.12.1.20.1",
            "35.12.2.38.1",
            "36.12.3.66.1",
            "37.13.0.94.1",
            "38.13.1.89.1",
            "39.13.2.46.1",
            "40.13.3.56.1",
            "65.4.26.-47.1",
            "66.26.2.48.1",
            "76.6.26.28.1",
            "183.7.69.-75.0",
            "184.69.0.91.1",
            "199.13.73.4.1",
            "200.73.0.85.1",
            "274.4.100.77.1",
            "275.100.1.93.1",
            "311.11.112.94.1",
            "312.112.0.43.1",
            "391.10.139.100.1",
            "392.139.0.-10.1",
            "460.139.1.49.1",
            "512.7.182.100.1",
            "513.182.69.88.1",
            "644.182.139.-35.1",
            "694.69.100.61.1",
            "745.9.182.34.1",
            "813.12.277.100.1",
            "814.277.0.-100.1",
            "858.11.291.100.1",
            "859.291.3.50.1",
            "923.8.313.100.1",
            "924.313.0.56.1",
            "972.9.112.-3.1",
            "1041.6.139.72.1",
            "1104.12.372.100.1",
            "1105.372.2.7.1",
            "1212.73.26.-69.1"
        ]

        // Generate networks
        let baseGenome = generateGenome()
        for(let i = 0; i < populationSize; i++)
        {
           let net = NeuralNetwork(!!seedNum ? seedGenes[i % seedNum] : [...baseGenome], bias, activation, outputActivation, `${generations}_${i}`, getGlobalInfo)
            // let net = NeuralNetwork([...tg1], bias, activation, outputActivation, `${generations}_${i}`, getGlobalInfo)
           net.mutateWeights(1)
           net.generateNetwork()
           population.push(net)
        }

        // population.forEach(nn => console.log({
        //     id: nn.getId(),
        //     score: nn.getScore(),
        //     genome: nn.getGenome(),
        //     matrices: nn.getMatrices()
        // }))
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

        return NeuralNetwork(genes, bias, activation, outputActivation, `${generations}_${id}`, getGlobalInfo)
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
        "getGlobalInfo" : getGlobalInfo
    }
}