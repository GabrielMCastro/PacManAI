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
    * DynamicSplitFactor
    * SeedNumber
    * NewInputs
    * ProtectStructure
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
    * FullyConnected
*/
export const AITrainer = function (config)
{
    // ---- Configured --------------------------------------------------------
    // Population and run length
    let simNum = config?.SimNum ?? 1                   // Number of games running side by side, each plays one network at a time
    let populationSize = config?.PopulationSize ?? 1   // Number of networks in each generation
    let maxGenerations = config?.MaxGens ?? 1          // Training stops after this many generations

    // Mutation
    let wMutationR = config?.WeightMutationR ?? .25    // Chance (per gene) that a child's connection weight is replaced with a new random weight in [-1, 1]
    let sMutationR = config?.StructureMutationR ?? 1   // Chance (per child) of one structural mutation: either adding a node or adding a connection
    let sMutationSplit = config?.StructureMutationSplit ?? -1 // Chance a structural mutation adds a node rather than a connection.
                                                              // -1 = dynamic: grows as the network gets more fully connected (see dynamicSplit)
    let dynamicSplit =  config?.DynamicSplitFactor ?? 1 // Dynamic split only: multiplier on (connections / possible connections).
                                                        // Lower = prefer adding connections for longer before adding nodes

    // Seeding from saved networks (ai/seeds/net_N.txt)
    let seedNum = config?.SeedNumber ?? 0              // How many seed files to load into generation 0. 0 = start from scratch
    let newInputs = config?.NewInputs ?? 0             // Extra input nodes to add on top of the seeded networks. They start unconnected,
                                                       // hidden node numbers are shifted up to make room (see shiftConnections)
    let protect = config?.ProtectStructure ?? false    // If true, connections loaded from the seeds are never split by "add node" mutations

    // Speciation: compatibility distance = (c1 * excess + c2 * disjoint) / genes + c3 * average weight difference
    let compatibilitySpecs = {
        c1: 1,         // Weight of excess genes (innovations past the end of the other genome)
        c2: 1,         // Weight of disjoint genes (innovations missing from the other genome, inside its range)
        c3: 1,         // Weight of the average weight difference of matching genes
        threshold: 1,  // Networks closer than this to a species' representative join that species
        ...config?.Compatibility
    }

    // Reproduction
    let repPercentile = config?.ReproductionPercentile ?? .5 // Within each species, only networks at or above this fitness percentile reproduce.
                                                             // .8 = roughly the top 20%

    // Network
    let bias = config?.Bias ?? 1                       // Constant added to every node before activation, the same for all nodes and not evolved.
                                                       // On the outputs it has no effect, softmax ignores a value added to every output
    let gpuMultiplication = config?.GPUMultiplication ?? false // Use gpu.js for the matrix multiply. Broken, the gpu.js import is commented out
    let fullyConnected = config?.FullyConnected ?? true // true = generation 0 starts with every input connected to every output,
                                                        // false = generation 0 starts with no connections at all

    // ---- Genome identifier ---------------------------------------------------
    // Shared by every network in the population. Node numbers are laid out as
    //   outputs: 0 .. outputs-1 | inputs: outputs .. outputs+inputs-1 | hidden: after that
    let inputs = config?.Inputs ?? 0         // Number of input nodes, must match the length of game.js getInput()
    let hidden = 0                           // Number of hidden nodes ever created across the whole population
    let outputs = config?.Outputs ?? 0       // Number of output nodes (4: straight, right, back, left)
    let innovations = 0                      // Global innovation counter, every new connection gets the next number.
                                             // Matching numbers are how crossover and speciation line genes up between genomes
    let protectedInnovations = 0             // Genes with an innovation number at or below this are never split (ProtectStructure)

    // ---- Activation functions ------------------------------------------------
    let sigmoid = (x) => (1/(1 + Math.exp(-x)))
    let tanh = (x) => ((Math.exp(x) - Math.exp(-x))/(Math.exp(x) + Math.exp(-x)))
    let softmax = (vect) => {
        let sumExp = vect.reduce((curr, val) => Math.exp(val) + curr, 0)
        let x = vect.map((x) => (Math.exp(x) / sumExp))

        return x
    }
    let activation = config?.ActivationFunc ?? tanh                 // Used on hidden nodes
    let outputActivation = config?.OutputActivationFunc ?? softmax  // Used on the output layer, the highest output is the move

    // ---- Training state ------------------------------------------------------
    let generations = 0                // Current generation number, starting at 0
    let currentNet  = simNum - 1       // Index of the most recently handed out network. The first simNum networks
                                       // are handed out at the start, one per game, so this starts at simNum - 1
    let maxScore = 0                   // Highest score any network has reached this generation
    let topNetwork                     // Unused
    let generationOver = false         // True once every network has been handed out (some may still be playing)
    let completedNets = 0              // Number of networks that have finished their run this generation
    let population = []                // This generation's networks
    let species = []                   // Last generation's species, as lists of genomes. A random member of each
                                       // is used as the representative when speciating the next generation
    let simCurrentNets = Array.apply(null, Array(simNum)).map((v, i) => i) // For each game, the index of the network it's playing

    // Initialize
    init()
    
    function init() {
        // TODO: REWORK
        let seedGenes = []
        for (let i = 0; i < seedNum; i++) {
            let rawFile = new XMLHttpRequest()
            // if (i == 10) i = 14
            // if (i == 24) i = 26
            // if (i == 44) i = 53
            // if (i == 63) i = 191
            rawFile.open("GET", `/ai/seeds/net_${i}.txt`, false)
            rawFile.onreadystatechange = () => {
                if(rawFile.status === 200 || rawFile.status == 0)
                {
                    let allText = rawFile.responseText;
                    let genome = allText.replace(/\[/g, "").replace(/\]/g, "")
                                        .replace(/\"/g, "").split(",")
                    if (i == 0) {
                        let global = genome[0].split(".")
                        innovations = parseInt(global[0])
                        if (protect) protectedInnovations = innovations
                        inputs =  parseInt(global[1]) + newInputs
                        hidden =  parseInt(global[2])
                        outputs = parseInt(global[3])
                    }
                    // A network with no connections is saved as an empty list, which parses to [""]
                    let genes = genome.slice(1).filter(g => g != "").map(g => shiftConnections(g))
                    seedGenes.push(genes)
                }
            }
            rawFile.send(null)
        }
        // TODO END

        // Generate networks
        let baseGenome = fullyConnected ? generateGenome() : []
        for(let i = 0; i < populationSize; i++)
        {
           let net = NeuralNetwork(!!seedNum ? seedGenes[i % seedGenes.length] : [...baseGenome], bias, activation, outputActivation, `${generations}_${i}`, getGlobalInfo, gpuMultiplication, protectedInnovations)
           net.mutateWeights(!!seedNum ? .1 : 1)
           net.generateNetwork()
           population.push(net)
        }
    }

    // Shifts existing nodes to accomodate new input nodes
    function shiftConnections(gene) {
        let dna = gene.split(".")
        dna[1] = parseInt(dna[1]) >= (outputs + (inputs - newInputs)) ? parseInt(dna[1]) + newInputs : dna[1]
        dna[2] = parseInt(dna[2]) >= (outputs + (inputs - newInputs)) ? parseInt(dna[2]) + newInputs : dna[2]
        return dna.join(".")
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
        completedNets += 1
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
        completedNets = 0
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
        newPopulation.forEach(n => n.mutateStructure(sMutationR, sMutationSplit, dynamicSplit, addInnovations))

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

        W[1] = W[1] != 0 ? W[1] : 1
        let c = (((c1 * (E[0] + E[1])) + (c2 * (D[0] + D[1]))) / N) + (c3 * (W[0] / W[1]))
        return !isNaN(c) ? c : 0
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

        return NeuralNetwork(genes, bias, activation, outputActivation, `${generations}_${id}`, getGlobalInfo, gpuMultiplication, protectedInnovations)
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

    // Returns the configuration in use with defaults filled in. Leaves out the functions
    // (activation) and GPUMultiplication, which is broken
    function getConfig() {
        return {
            SimNum: simNum,
            PopulationSize: populationSize,
            MaxGens: maxGenerations,
            WeightMutationR: wMutationR,
            StructureMutationR: sMutationR,
            StructureMutationSplit: sMutationSplit,
            DynamicSplitFactor: dynamicSplit,
            SeedNumber: seedNum,
            NewInputs: newInputs,
            ProtectStructure: protect,
            Inputs: config?.Inputs ?? 0, // As configured, seeding can change the inputs actually used
            Outputs: config?.Outputs ?? 0,
            ReproductionPercentile: repPercentile,
            Compatibility: { ...compatibilitySpecs },
            Bias: bias,
            FullyConnected: fullyConnected,
        }
    }

    // Returns the number of networks that have finished running this generation
    function getCompletedCount() {
        return completedNets
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
        return population[simCurrentNets[sim]]?.getId()
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
        "getCompletedCount" : getCompletedCount,
        "getConfig" : getConfig,
        "getCurrentNetId" : getCurrentNetId,
        "getGlobalInfo" : getGlobalInfo,
        "getCurrentNetScore" : getCurrentNetScore
    }
}