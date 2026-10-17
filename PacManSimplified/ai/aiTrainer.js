import { NeuralNetwork } from "./neuralNetwork.js"

/** 
    Handles managing population of networks, reproduction, saving top networks
    (Saving networks to ai/seeds actually lives in simulationenvironment.js, this file only
    loads them in init().)

    OVERVIEW
    This is the NEAT (NeuroEvolution of Augmenting Topologies) trainer. It owns the population
    of NeuralNetworks (ai/neuralNetwork.js), hands them out to the games that play them
    (game.js), collects each network's fitness, and breeds the next generation from them.

    THE GENERATION CYCLE
      1. A generation starts with the population split across SimNum games running side by
         side, each game playing one network at a time. Game k starts on network k
         (simCurrentNets), so networks 0..SimNum-1 are handed out right away and currentNet
         starts at SimNum-1 ("the most recently handed out network").
      2. While a game plays, game.js calls execute(input, sim) whenever pacman has to decide.
         It runs that game's current network and returns a move RELATIVE to pacman's heading:
         0 straight, 1 right, 2 back, 3 left. game.js turns it into an absolute direction
         with (output + direction) % 4.
      3. On game over, game.js calls finishGame(score, secondsAlive, sim). With
         GamesPerNetwork > 1 the same network replays until it has played that many games.
         After its last game its fitness is set to the average of its games and moveToNext()
         hands that game the next unplayed network (currentNet + 1).
      4. When there are no unplayed networks left, generationOver becomes true and that game's
         simHasNet is set to false, so game.js lets it go idle. Other games may still be
         finishing their last network at this point.
      5. simulationenvironment.js waits until isGenerationOver() and every game is idle, then
         calls advanceGeneration(). That resets the bookkeeping above and calls
         generateNewPopulation() to breed the next population from this one's fitnesses.

    NEAT AS IMPLEMENTED HERE (generateNewPopulation and its helpers)
      * Every connection is a gene with a global innovation number, handed out from one counter
        shared by the whole population. Two genes with the same innovation number are "the same
        connection" in two genomes. That is how genomes of different shapes get lined up
        (alignGenes) for crossover and for measuring how different they are.
      * Speciation: networks are grouped into species by compatibility distance (compatibility()).
        A network with a new structure then mostly competes with similar networks, which gives it
        a few generations to tune its weights instead of being out-competed right away.
      * Fitness sharing: each species gets a number of children proportional to its AVERAGE
        fitness, not its total, so a species can't take over the population just by being big.
      * Within a species only the top members (ReproductionPercentile) reproduce. Children are
        crossovers of two of them, followed by weight and structure mutations.
      * Elitism: the best network of every species with at least 5 members is copied unchanged.

    DATA FORMATS
      * Gene: a string "innovation.from.to.weight.enabled", e.g. "193.4.0.92.1" = innovation 193,
        a connection from node 4 to node 0 with weight 0.92, enabled. The weight is stored x100 as
        an integer (92 = 0.92), and mutation nudges keep it within [-300, 300] (i.e. [-3, 3]).
        enabled is 1 or 0. A connection that got split by an "add node" mutation stays in the
        genome with enabled = 0.
      * Genome: an array of gene strings. NeuralNetwork.getGenome() returns a copy.
      * Node numbers are shared by the whole population (see "Genome identifier" below):
        outputs 0..outputs-1, then inputs outputs..outputs+inputs-1, then hidden nodes.
      * population: array of NeuralNetwork objects (score, genome, matrices).
      * species: array of species from the last speciation, each a list of GENOMES (gene string
        arrays), not networks. Inside generateNewPopulation, newSpecies is the same idea but as
        lists of NETWORKS, since their scores are needed there.
      * Seed file (ai/seeds/net_N.txt): ["innovations.inputs.hidden.outputs.",["gene","gene",...]], with the
        network's fitness as a third element when it was saved from a scored generation. Saves are sorted
        best first, so net_0 is the best and SeedNumber = N loads the top N

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
    * GamesPerNetwork
    * SurvivalBonus
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
    let wMutationR = config?.WeightMutationR ?? .25    // Chance (per gene) that a child's connection weight mutates: usually a small nudge, sometimes a new random weight in [-1, 1]. See mutateWeights in neuralNetwork.js
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

    // Fitness: a network's fitness is the average over its games of (game score + survival bonus)
    let gamesPerNet = config?.GamesPerNetwork ?? 1     // Games each network plays per generation. Averaging over several games stops one lucky
                                                       // (or unlucky) game with random ghosts from deciding a network's fitness
    let survivalBonus = config?.SurvivalBonus ?? 0     // Points per second (FPS ticks) pacman is alive in a game. Starvation ends a game
                                                       // after a few seconds without eating, so hiding can't farm it forever.
                                                       // The seconds game.js passes only count up to the last pellet eaten,
                                                       // so the time spent starving before death earns nothing

    // Network
    let bias = config?.Bias ?? 1                       // Constant added to every node before activation, the same for all nodes and not evolved.
                                                       // On the outputs it has no effect, softmax ignores a value added to every output
    let gpuMultiplication = config?.GPUMultiplication ?? false // Use gpu.js for the matrix multiply. Broken, the gpu.js import is commented out
    let fullyConnected = config?.FullyConnected ?? true // true = generation 0 starts with every input connected to every output,
                                                        // false = generation 0 starts with no connections at all.
                                                        // NOTE: the default here is true, but the starting config in
                                                        // simulationenvironment.js sets it to false

    // ---- Genome identifier ---------------------------------------------------
    // Shared by every network in the population. Node numbers are laid out as
    //   outputs: 0 .. outputs-1 | inputs: outputs .. outputs+inputs-1 | hidden: after that
    let inputs = config?.Inputs ?? 0         // Number of input nodes, must match the length of game.js getInput()
    let hidden = 0                           // Number of hidden nodes ever created across the whole population
    let outputs = config?.Outputs ?? 0       // Number of output nodes (4: straight, right, back, left)
    let innovations = 0                      // Global innovation counter, every new connection gets the next number.
                                             // Matching numbers are how crossover and speciation line genes up between genomes
    let protectedInnovations = 0             // Genes with an innovation number at or below this are never split (ProtectStructure)

    // These four values are read by every network through getGlobalInfo(), which is passed to
    // NeuralNetwork as a callback. A network adding a node or connection calls addInnovations()
    // to bump hidden and innovations, so node and innovation numbers never collide across the population.
    // NOTE: init() overwrites inputs, hidden, outputs and innovations from the first seed file
    // when seeding, so the configured Inputs/Outputs are ignored in that case.

    // ---- Activation functions ------------------------------------------------
    let sigmoid = (x) => (1/(1 + Math.exp(-x))) // Unused, kept as an alternative ActivationFunc
    let tanh = (x) => ((Math.exp(x) - Math.exp(-x))/(Math.exp(x) + Math.exp(-x))) // Same as Math.tanh, output in (-1, 1)
    // Turns the output sums into probabilities that add up to 1: e^x / sum of e^x.
    // Only the largest one matters (decision() in neuralNetwork.js picks it), and softmax keeps the
    // order, so it doesn't change which move is picked. It also ignores a constant added to every
    // value (e^(x+b) / sum e^(x+b) = e^x / sum e^x), which is why Bias has no effect on outputs.
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
    let maxScore = 0                   // Highest fitness any network has reached this generation (the averaged fitness, bonus included)
    let topNetwork                     // Unused
    let generationOver = false         // True once every network has been handed out (some may still be playing)
    let completedNets = 0              // Number of networks that have finished their run this generation
    let population = []                // This generation's networks
    let species = []                   // Last generation's species, as lists of genomes. A random member of each
                                       // is used as the representative when speciating the next generation
    let simCurrentNets = Array.apply(null, Array(simNum)).map((v, i) => i) // For each game, the index of the network it's playing
    let simGameFitnesses = simCurrentNets.map(() => [])  // For each game, the fitness of each finished game of its current network
    let simHasNet = simCurrentNets.map(() => true)       // For each game, false once there are no networks left for it this generation
    let lastGeneration = null          // The generation that bred the current population, grouped into its species with
                                       // fitness, for the network diagrams. Set by generateNewPopulation, null during generation 0
    // NOTE: these assume populationSize >= simNum. With fewer networks than games, the extra
    // games start on indexes past the end of the population.
    // NOTE: "score" everywhere in this file (setScore, getScore, maxScore) means fitness: the
    // average over a network's games of game score + SurvivalBonus * seconds.

    // Initialize
    init()
    
    // Builds generation 0. Called once, from the constructor above.
    //   1. If SeedNumber > 0, load seed files ai/seeds/net_0.txt .. net_(SeedNumber-1).txt. The
    //      header of net_0 sets the global counters (innovations, inputs, hidden, outputs), and
    //      every gene is passed through shiftConnections() to make room for NewInputs.
    //   2. Create PopulationSize networks: seeded ones cycle through the loaded seeds
    //      (network i gets seed i % seeds), otherwise each gets a copy of the base genome
    //      (fully connected inputs -> outputs, or empty).
    //   3. Mutate every network's weights a little so the copies aren't identical, then build
    //      its matrices with generateNetwork().
    // No structural mutation happens here, the first structure changes come in
    // generateNewPopulation() after generation 0 has been played.
    // NOTE: with FullyConnected false and no seeds, every generation 0 network is empty. With no
    // output connections decision() falls back to 0 (straight) every time, so generation 0 is all
    // identical networks and its fitness differences come only from the games' randomness.
    function init() {
        // TODO: REWORK
        let seedGenes = [] // One genome (array of gene strings) per seed file that loaded
        for (let i = 0; i < seedNum; i++) {
            // Synchronous request (third argument false): send() blocks until the file arrives,
            // so seedGenes is complete when the loop ends (browsers warn that synchronous XHR on
            // the main thread is deprecated).
            // NOTE: a seed that fails to load (e.g. 404) is skipped silently, seedGenes just ends
            // up shorter. If none load, seedGenes is empty and step 2 below breaks
            // (i % 0 is NaN, so the network gets an undefined genome).
            let rawFile = new XMLHttpRequest()
            // if (i == 10) i = 14
            // if (i == 24) i = 26
            // if (i == 44) i = 53
            // if (i == 63) i = 191
            rawFile.open("GET", `/ai/seeds/net_${i}.txt`, false)
            rawFile.onreadystatechange = () => {
                if(rawFile.status === 200 || rawFile.status == 0) // 0 is what file:// URLs report on success
                {
                    let allText = rawFile.responseText;
                    // The file is ["innovations.inputs.hidden.outputs.",["gene","gene",...]].
                    // Stripping the brackets and quotes and splitting on commas gives a flat list:
                    //   genome[0] = the header "innovations.inputs.hidden.outputs." (population counters at save time)
                    //   genome[1..] = the gene strings
                    // A seed file is JSON: [header, [gene, ...]] or, when saved with scores, [header, [gene, ...], fitness].
                    // Flattened to [header, gene, gene, ...] for the code below; the fitness isn't needed here
                    let [header, savedGenes] = JSON.parse(allText)
                    let genome = [header, ...savedGenes]
                    // Only the first seed's header is read. All seeds are expected to come from the same
                    // saved population, so they share the same counters.
                    // NOTE: seeds saved from different runs would have conflicting node and innovation numbers.
                    if (i == 0) {
                        // e.g. "7819.12.1141.4." -> ["7819", "12", "1141", "4", ""]
                        let global = genome[0].split(".")
                        innovations = parseInt(global[0])
                        if (protect) protectedInnovations = innovations // Every innovation that existed at save time, i.e. every seeded gene
                        inputs =  parseInt(global[1]) + newInputs // The new input nodes go right after the saved ones
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
        // NOTE: generateGenome() runs whenever fullyConnected is true, even when seeding. Its genome
        // is then unused, but it still uses up inputs * outputs innovation numbers (a harmless gap).
        let baseGenome = fullyConnected ? generateGenome() : []
        for(let i = 0; i < populationSize; i++)
        {
            // Seeded: network i gets seed i % seeds, so with 10 seeds and 50 networks each seed is used 5 times.
            // Not seeded: each network gets its own copy ([...]) of the base genome.
            // The id is "generation_index", e.g. "0_17".
            // NOTE: the seeded genome is passed without copying, and NeuralNetwork keeps the array it's
            // given. Networks sharing a seed therefore share one genome array, and mutateWeights writes
            // into it in place, so all copies of a seed end up with the same (accumulated) weights.
            //
            // The mutation rate is .1 for seeds (light variation of already-trained networks) and 1 from scratch.
            // NOTE: mutateWeights nudges a weight 90% of the time (and replaces it 10%), so rate 1 on a
            // fully connected base genome (every weight 100) still gives very similar networks. With
            // FullyConnected false the base genome is empty and this does nothing.
           let net = NeuralNetwork(!!seedNum ? seedGenes[i % seedGenes.length] : [...baseGenome], bias, activation, outputActivation, `${generations}_${i}`, getGlobalInfo, gpuMultiplication, protectedInnovations)
           net.mutateWeights(!!seedNum ? .1 : 1)
           net.generateNetwork()
           population.push(net)
        }
    }

    // Shifts existing nodes to accomodate new input nodes
    // Called by init() on every seeded gene. gene is a gene string, returns the gene with its from/to
    // node numbers moved up by NewInputs if they are hidden nodes.
    // Why: inputs sit right before hidden nodes in the shared numbering, so adding input nodes means
    // the new inputs take the numbers where the first hidden nodes used to be. Every hidden node moves
    // up by newInputs, while outputs and the old inputs keep their numbers.
    // Example: 4 outputs, 12 saved inputs, newInputs = 2. outputs + (inputs - newInputs) = 4 + 12 = 16 is
    // the first hidden node in the saved numbering. "50.16.0.92.1" becomes "50.18.0.92.1", while
    // "51.5.0.40.1" (input 5 -> output 0) stays. The new inputs are nodes 16 and 17, unconnected.
    // Relies on inputs having already been increased by newInputs (done just before, in init()).
    // Untouched node numbers keep their original string, shifted ones become numbers, join() handles both.
    function shiftConnections(gene) {
        let dna = gene.split(".")
        dna[1] = parseInt(dna[1]) >= (outputs + (inputs - newInputs)) ? parseInt(dna[1]) + newInputs : dna[1]
        dna[2] = parseInt(dna[2]) >= (outputs + (inputs - newInputs)) ? parseInt(dna[2]) + newInputs : dna[2]
        return dna.join(".")
    }

    // Get the global state of the genome
    // All hidden nodes and innovations across entire population
    // Passed to every NeuralNetwork as a callback so they always see the live counters: generateNetwork()
    // uses inputs/outputs to size the matrices, mutateStructure() uses them to pick nodes and number new ones.
    // Also used by simulationenvironment.js (e.g. to check seeded input counts and to save networks).
    function getGlobalInfo() {
        return {
            inputs,
            hidden,
            outputs,
            innovations
        }
    }

    // Execute a specific sim's network with the given input
    // Called by game.js every time pacman decides on a move. input is the array from game.js getInput()
    // (must have exactly Inputs values), sim is the game's index. Returns the chosen output index, a move
    // relative to pacman's heading: 0 straight, 1 right, 2 back, 3 left.
    function execute(input, sim)
    {
        return population[simCurrentNets[sim]].execute(input)
    }

    // Set the score for a specific sim's network
    // Also keeps maxScore up to date. score here is the network's final fitness (see finishGame).
    // NOTE: setScore is declared twice in this file (here and again below finishGame). Both are
    // function declarations in the same scope, so the second one silently replaces this one. They are
    // identical, so nothing breaks, but only one is needed.
    function setScore(score, sim)
    {
        (score > maxScore) ? maxScore = score : null // Ternary used as an if: only assigns when it's a new best
        population[simCurrentNets[sim]].setScore(score)
    }

    // Record a finished game for a specific sim's network. Once the network has played
    // gamesPerNet games its fitness is set to their average and the sim moves to the next network,
    // until then the sim replays the same network
    // score = the game's score, secondsAlive = how long pacman was alive (ticks / FPS)
    // Called by game.js on game over (out of lives). sim is the game's index.
    // secondsAlive only counts up to the last pellet eaten (game.js passes aliveTicksAtFood / FPS),
    // so time spent wandering without eating before starving earns no bonus.
    // Example with GamesPerNetwork 3, SurvivalBonus 1: games of (score 200, 30s), (100, 20s), (300, 50s)
    // give fitnesses 230, 120, 350. The first two calls just record and return (the game replays the
    // same network), the third sets the network's fitness to (230 + 120 + 350) / 3 = 233.3.
    function finishGame(score, secondsAlive, sim)
    {
        let games = simGameFitnesses[sim] // This game's fitnesses so far for its current network (same array, push updates it)
        games.push(score + (survivalBonus * secondsAlive))
        if (games.length < gamesPerNet) return // More games to play with this network

        // Rounded to 1 decimal, the bonus and the average make long decimals
        let fitness = Math.round((games.reduce((sum, f) => sum + f, 0) / games.length) * 10) / 10
        // let fitness = Math.max(...games) // Best of the games instead, rewards luck rather than consistency
        simGameFitnesses[sim] = [] // Fresh list for the next network
        setScore(fitness, sim) // Must happen before moveToNext, which changes which network simCurrentNets[sim] points at
        moveToNext(sim)
    }

    // Set the score for a specific sim's network
    // NOTE: duplicate of the setScore above, this is the declaration that's actually used.
    function setScore(score, sim)
    {
        (score > maxScore) ? maxScore = score : null
        population[simCurrentNets[sim]].setScore(score)
    }

    // Increment current network being tested and assign to given sim
    // Called by finishGame once a network has played all its games. Networks are handed out in order
    // to whichever game frees up first, so with 3 games and 10 networks, games start on 0, 1, 2 and the
    // next game to finish gets 3, the next 4, and so on. currentNet is the shared "last handed out" index.
    // Once network population.length - 1 has been handed out, each game that finishes goes idle instead.
    // Exported too, but nothing outside this file calls it.
    function moveToNext(sim)
    {
        completedNets += 1 // Counts the network that just finished, for the progress display
        if(currentNet < (population.length - 1)) // Still an unplayed network left
        {
            currentNet += 1
            simCurrentNets[sim] = currentNet
        } else {
            // Everything has been handed out. generationOver only means that, other games may still be
            // playing their last network, which is why simulationenvironment.js also waits for every game to be idle
            generationOver = true
            simHasNet[sim] = false // game.js checks hasNetwork() and lets this game go idle
        }
    }

    // Returns true if the sim has a network to play (it may be partway through that network's games)
    function hasNetwork(sim) {
        return simHasNet[sim]
    }

    // Returns which game (1 to gamesPerNet) the sim's current network is on
    function getCurrentGameNumber(sim) {
        return simGameFitnesses[sim].length + 1
    }

    // Generate base genome of input*output default connections
    // Used by init() when FullyConnected is true. Every input connects straight to every output with
    // weight 1.00 (stored as 100), enabled, and each connection takes the next global innovation number.
    // Since this runs once and every network copies the result, those innovation numbers match across the
    // whole population. Example with 2 inputs, 4 outputs (inputs are nodes 4 and 5):
    //   "1.4.0.100.1", "2.4.1.100.1", "3.4.2.100.1", "4.4.3.100.1", "5.5.0.100.1", ... "8.5.3.100.1"
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
    // Called by simulationenvironment.js once isGenerationOver() and every game is idle (after it has
    // logged the finished generation). Must be called after every fitness is in, since breeding reads them.
    // generations is bumped first, so children are created with ids of the new generation.
    function advanceGeneration() {
        generations += 1
        currentNet = simNum - 1
        maxScore = 0
        generationOver = false
        completedNets = 0
        simCurrentNets = simCurrentNets.map((v, i) => i) // Game k starts on network k again
        simGameFitnesses = simCurrentNets.map(() => [])
        simHasNet = simCurrentNets.map(() => true)
        generateNewPopulation()
    }

    // Generate a new population
    // * Separate into species
    // * Cull weak members
    // * Generate new population
    // * Mutate weights of new population
    // * Mutate structure of new population
    //
    // The heart of NEAT. Called by advanceGeneration() once every network in population has a fitness
    // (getScore()). Replaces population with the children (plus elites) and species with this
    // generation's species. Steps, marked in the body:
    //   1. Speciate: put every network into the species of the first old representative it's close to
    //      (compatibility < threshold), or found a new species.
    //   2. Sort each species ascending by score.
    //   3. Elitism: the best member of each species with >= 5 members goes into the next generation unchanged.
    //   4. Fitness sharing: adjusted fitness = score / species size. Decide how many children each species gets.
    //   5. Cull: within each species, only members at or above the ReproductionPercentile reproduce.
    //   6. Breed: each child is the crossover of two random reproducers from the same species.
    //   7. Mutate every child's weights, then (maybe) its structure.
    //   8. Build every child's (and elite's) matrices.
    //   9. Store species (as genomes, for next time) and the new population.
    function generateNewPopulation()
    {
        // ---- 1. Speciate ----
        // One representative genome per species from LAST generation, picked at random from its members.
        // species is empty the first time this runs (breeding from generation 0), so the first network founds
        // species 0 and becomes its rep.
        let oldSpeciesRep = species.map((v) => v[Math.floor(Math.random() * v.length)]) // Representative of the old species used to speciate new population
        // newSpecies[j] = this generation's networks (NeuralNetwork objects) whose species is represented by
        // oldSpeciesRep[j]. The two arrays must share indexes. An old species that nobody joins leaves a
        // hole (undefined) at its index. forEach/map/reduce/filter skip holes, plain for loops don't.
        let newSpecies = [] // Networks separated into new species

        // Speciate entire population
        // Each network joins the FIRST species it's compatible with, in order, not the closest one.
        for (let i = 0; i < population.length; i++) {
            let foundSpecies = false
            for (let j = 0; j < oldSpeciesRep.length && !foundSpecies; j++) {
                if (compatibility(population[i].getGenome(), oldSpeciesRep[j], compatibilitySpecs.c1, compatibilitySpecs.c2, compatibilitySpecs.c3) < compatibilitySpecs.threshold) { // If net meets compatibility threshold of rep
                    newSpecies[j] = [...(newSpecies[j] ?? []), population[i]] // Add to species
                    foundSpecies = true
                }
            }

            // If no species found create a new species
            // The new species goes at index oldSpeciesRep.length (not newSpecies.length) and this network
            // becomes its representative, so the indexes of newSpecies and oldSpeciesRep stay in step even
            // when holes exist. Later networks in this loop can then join it.
            // Example: 3 old species, nobody joins species 1, a network fits none of them:
            //   newSpecies = [[a, b], <hole>, [c], [d]], oldSpeciesRep = [rep0, rep1, rep2, d's genome]
            if (!foundSpecies) {
                newSpecies[oldSpeciesRep.length] = [population[i]]
                oldSpeciesRep.push(population[i].getGenome())
            }
        }
        // ---- 2. Sort ----
        // Order on score
        // Ascending, so the best member is last. Later steps rely on this order: elitism takes the last
        // element, and the cull indexes the sorted adjusted fitnesses to find the percentile cutoff.
        newSpecies.forEach(s => s.sort((a, b) => a.getScore() - b.getScore()))

        // ---- 3. Elitism ----
        // Get best member of each species with 5 or more members
        // The elite is the same NeuralNetwork object, carried over unchanged (no crossover, no mutation), so
        // a good network can't be lost to an unlucky generation of children. The size limit follows the
        // original NEAT paper, which copies the champion of every species with more than five networks.
        // NOTE: an elite keeps last generation's fitness and id until it's replayed and setScore overwrites it.
        // This is a plain for loop, so unlike map/filter/forEach (steps 4-9) it visits holes too: an old species
        // that got no members this generation is undefined here whenever a later index is filled. The ?. treats
        // a hole as too small for an elite instead of throwing (it used to throw a TypeError and stop training).
        let elities = []
        for (let i = 0; i < newSpecies.length; i++) {
            if (newSpecies[i]?.length >= 5) { // ?. skips holes (old species with no members this generation)
                let s = newSpecies[i]
                elities.push(s[s.length - 1])
            }
        }

        // ---- 4. Fitness sharing ----
        // Find fitness of each member relative to their species size
        // adjustedFitnesses has the same shape (and holes) as newSpecies, and the same ascending order.
        // Dividing by the species size means a species' adjusted fitnesses add up to its AVERAGE score.
        let adjustedFitnesses = newSpecies.map(v => v.map(n => (n.getScore() / v.length)))
        // Use that to find the species distribution of the new population
        // totalFitness = sum of every species' average score
        let totalFitness = adjustedFitnesses.reduce((sum, val) => val.reduce((c, v) => c + v, 0) + sum, 0)
        // Each species' share = its average / sum of averages, times the free slots (elites already have theirs),
        // rounded. So the number of children follows a species' average score, not how many members it has.
        // Worked example, PopulationSize 20:
        //   A: 5 members scoring [10, 20, 30, 40, 50] -> adjusted [2, 4, 6, 8, 10], sum 30 (= its average)
        //   B: 2 members scoring [50, 50]             -> adjusted [25, 25],         sum 50
        //   C: 1 member  scoring [5]                  -> adjusted [5],              sum 5
        //   totalFitness = 85. Only A has >= 5 members, so 1 elite and 20 - 1 = 19 free slots.
        //   A: 30/85 * 19 = 6.7 -> 7,  B: 50/85 * 19 = 11.2 -> 11,  C: 5/85 * 19 = 1.1 -> 1.  7 + 11 + 1 + 1 elite = 20
        //   B gets the most children with only 2 members, because its average is highest.
        // If every score is 0 (e.g. every network died without eating anything and SurvivalBonus is 0) the shares would be
        // 0/0, so instead each species just keeps its current size.
        // NOTE: each share is rounded on its own, so the total can drift a little from PopulationSize (three
        // equal species sharing 20 slots get 6.67 -> 7 each = 21). It doesn't accumulate, every generation is
        // computed from PopulationSize again, but population.length (getPopulationSize()) can be off by a few.
        // NOTE: the all-zero fallback doesn't subtract the elites, so the population grows by the number of elites.
        // NOTE: a species of one lucky network gets its whole score as its average, so one lucky game can win
        // a big share of the next generation (averaging over GamesPerNetwork helps here).
        let reproductionDistribution = (totalFitness > 0) 
        ? adjustedFitnesses.map((val) => val.reduce((c,v) => c + v, 0) / totalFitness).map((v) => Math.round(v * (populationSize - elities.length)))
        : adjustedFitnesses.map((v) => v.length)

        // ---- 5. Cull ----
        // Cull weak members
        // The cutoff is the adjusted fitness at the ReproductionPercentile position of the (ascending) sorted list.
        // Everyone at or above it reproduces, so ties at the cutoff all get in and there's always at least one.
        // Within one species every member is divided by the same size, so this is the same as comparing raw scores.
        // Example with adjusted [2, 4, 6, 8, 10]:
        //   repPercentile .5: index round(4 * .5) = 2, cutoff 6  -> reproducers are the members with 6, 8, 10
        //   repPercentile .8: index round(4 * .8) = 3, cutoff 8  -> reproducers are the members with 8, 10
        //   (top 2 of 5 here, the "top 20%" reading only holds roughly for bigger species)
        let percentileFitnesses = adjustedFitnesses.map((v) => v[Math.round((v.length - 1) * repPercentile)])
        // reproducers[i] = the networks of species i that passed the cutoff (still ascending, holes kept)
        let reproducers = newSpecies.map((v, i) => v.filter((_, j) => adjustedFitnesses[i][j] >= percentileFitnesses[i]))

        // ---- 6. Breed ----
        // Generate new population
        // Species i produces reproductionDistribution[i] children. Each child picks two random reproducers of
        // that species (with replacement, so both can be the same network, which makes the child a clone
        // before mutation). Parents never come from different species.
        // For holes, reproductionDistribution[i] is undefined and j < undefined is false, so they're skipped.
        // Child ids are "generation_species_child", e.g. "12_3_0".
        let newPopulation = []
        for (let i = 0; i < reproducers.length; i++) {
            for (let j = 0; j < reproductionDistribution[i]; j++) {
                let net1 = reproducers[i][Math.floor(Math.random() * reproducers[i].length)]
                let net2 = reproducers[i][Math.floor(Math.random() * reproducers[i].length)]
                newPopulation.push(crossover(net1, net2, `${i}_${j}`))
            }
        }

        // ---- 7. Mutate ----
        // Mutate weights
        // Each gene of each child mutates with chance WeightMutationR (mostly a small nudge, see neuralNetwork.js)
        newPopulation.forEach(n => n.mutateWeights(wMutationR))

        // Mutate structure
        // Each child has chance StructureMutationR of one structural change: add a node (split a connection)
        // or add a connection, chosen by the split. addInnovations is how the child reserves new global
        // innovation/hidden node numbers. Elites are skipped, they stay unchanged.
        // NOTE: there is no per-generation record of structural changes, so two children that add the same
        // connection this generation get different innovation numbers, and later count as disjoint from each other.
        newPopulation.forEach(n => n.mutateStructure(sMutationR, sMutationSplit, dynamicSplit, addInnovations))

        // ---- 8. Build ----
        // Generate networks
        // Turn genomes into matrices. Has to come after all mutations. Elites are rebuilt too, which leaves
        // their connections the same but refreshes their snapshot of the global counters.
        newPopulation.forEach(n => n.generateNetwork())
        elities.forEach(n => n.generateNetwork())

        // ---- 9. Update ----
        // Update
        // species keeps this generation's grouping as genomes; next generation picks its representatives from it.
        // The filter also drops holes (filter skips them), so species has no gaps and its indexes are renumbered.
        // That's fine, species indexes only need to match within one call (newSpecies vs oldSpeciesRep).
        // Elites go last, so they're the last networks handed out next generation.
        species = newSpecies.map(s => s.map(nn => nn.getGenome())).filter(s => s?.length > 0) // Filter extinct
        population = [...newPopulation, ...elities]

        // Keep the finished generation's grouping for the page (getLastGeneration). Fitness is copied now because an elite's
        // score gets overwritten when it's replayed. Holes are skipped by map and dropped by the filter
        lastGeneration = {
            generation: generations - 1,
            species: newSpecies.map((s, i) => ({
                networks: [...s].reverse().map(n => ({ network: n, fitness: n.getScore(), elite: elities.includes(n) })),
                average: s.reduce((sum, n) => sum + n.getScore(), 0) / s.length,
                best: s[s.length - 1].getScore(),
                children: reproductionDistribution[i],
            })).filter(s => s).sort((a, b) => b.average - a.average),
        }
    }

    // Increment the innovation number and hidden nodes by requested amount and return new innovation number
    // Passed to mutateStructure() as a callback. i = innovations to reserve, h = hidden nodes to reserve.
    // Returns the counters AFTER the increase, so the caller's new numbers are the last i innovations
    // (innovations - i + 1 .. innovations) and the last h hidden nodes.
    // "Add node" calls addInnovations(2, 1): two new connections around one new node.
    // "Add connection" calls addInnovations(1, 0).
    function addInnovations(i, h) {
        innovations += i
        hidden += h
        return { innovations, hidden }
    }

    // Calculate compatibility between two genomes based on their excess and disjoint genes
    // Used by generateNewPopulation() step 1. g1, g2 are genomes (gene string arrays), c1-c3 the
    // Compatibility coefficients. Returns the NEAT compatibility distance (0 = identical, bigger = more different):
    //   distance = (c1 * excess + c2 * disjoint) / N  +  c3 * average |weight difference| of matching genes
    //   N = gene count of the larger genome (so big genomes aren't automatically far apart)
    // Gene kinds, comparing two genomes by innovation number:
    //   matching: the innovation is in both genomes
    //   disjoint: in only one genome, but inside the other genome's range of innovations (there are higher
    //             innovations in the other genome after it)
    //   excess:   in only one genome, past the other genome's last innovation
    //
    // How the loop counts them without knowing the ranges up front:
    //   Walk the aligned genes in innovation order. E holds a running count of genes seen in only one genome
    //   since the last "event". When something shows the run was inside the other genome's range, the run is
    //   moved into D (disjoint):
    //     - a matching gene: anything counted so far is followed by a gene the other genome has, so all of E
    //       is disjoint.
    //     - a gene from the other genome: the run from this genome is followed by a gene of the other one,
    //       so that run is disjoint.
    //   Whatever is still in E at the end has nothing from the other genome after it, so it's excess.
    //   E and D are [count from larger genome, count from smaller genome], only the totals are used.
    //
    // Worked example: larger has innovations 1 2 3 5 8 9, smaller has 1 2 4 5
    //   innov 1 both     -> match,                         E=[0,0] D=[0,0]
    //   innov 2 both     -> match,                         E=[0,0] D=[0,0]
    //   innov 3 l only   -> E=[1,0]
    //   innov 4 s only   -> l's run (3) is disjoint,       E=[0,1] D=[1,0]
    //   innov 5 both     -> match, s's run (4) disjoint,   E=[0,0] D=[1,1]
    //   innov 8 l only   -> E=[1,0]
    //   innov 9 l only   -> E=[2,0]
    //   end: excess = 2 (8 and 9), disjoint = 2 (3 and 4), N = 6, 3 matching genes.
    //   With c1 = c2 = c3 = 1: (2 + 2) / 6 + average weight difference of genes 1, 2, 5.
    function compatibility(g1, g2, c1, c2, c3) {
        let N = g1.length > g2.length ? g1.length : g2.length
        let W = [0,0] // To calculate weight different [total diff, matching genes]
        let E = [0,0] // Excess genes [l,s]
        let D = [0,0] // Disjoint genes [l,s]
        let alignedGenes = alignGenes(g1, g2) // Sparse array indexed by innovation number, see alignGenes
        
        // Walk every innovation number up to the highest one in either genome. Most indexes are holes
        // (innovations neither genome has); for those l and s are both undefined and nothing happens.
        for (let i = 0; i < alignedGenes.length; i++) {
            let l = alignedGenes[i]?.["l"], s = alignedGenes[i]?.["s"]
            if (!!l && !!s) { // If both have same gene
                // Update avg weight diff
                // Field 3 is the weight, stored x100, so /100 gives the real difference.
                // The enabled bit is ignored, a disabled gene still counts as matching.
                W[0] += Math.abs((l.split(".")[3] - s.split(".")[3])/100)
                W[1] += 1
                // Transfer excess genes to disjoint
                D = [D[0] + E[0], D[1] + E[1]]
                E = [0,0]
            } else if (!!l) { // Only a gene from the larger genome
                D[1] += E[1] // The smaller genome's run is followed by this gene, so it was disjoint
                E = [E[0] + 1, 0]
            } else if (!!s) { // Only a gene from the smaller genome
                D[0] += E[0] // The larger genome's run is followed by this gene, so it was disjoint
                E= [0, E[1] + 1]
            }
        }

        W[1] = W[1] != 0 ? W[1] : 1 // No matching genes: avoid 0/0, the weight term is then 0
        let c = (((c1 * (E[0] + E[1])) + (c2 * (D[0] + D[1]))) / N) + (c3 * (W[0] / W[1]))
        return !isNaN(c) ? c : 0 // Two empty genomes give 0/0 = NaN, they're identical so 0
    }

    // Returns genes aligned on innovation number
    // Aligned[innoN] = {"l": "innoNGene", "s": "innoNGene"}
    // Used by compatibility() and crossover(). g1, g2 are genomes (gene string arrays).
    // Returns a sparse array indexed by innovation number. Each filled index holds the gene with that
    // innovation from the larger genome (l) and/or the smaller genome (s), whichever have it. Missing
    // innovations are holes. Example, larger = ["1.4.0.92.1", "3.5.0.10.1"], smaller = ["1.4.0.50.1", "2.4.1.20.1"]:
    //   aligned[1] = {l: "1.4.0.92.1", s: "1.4.0.50.1"}   matching
    //   aligned[2] = {s: "2.4.1.20.1"}                     only in smaller
    //   aligned[3] = {l: "3.5.0.10.1"}                     only in larger
    //   aligned[0] is a hole (innovations start at 1), aligned.length = 4
    // Looping i from 0 to aligned.length therefore visits genes in innovation order, whatever order the
    // genomes store them in. "larger" = more genes, on a tie g1 counts as larger.
    function alignGenes(g1, g2) {
        let aligned = []
        let larger = g1.length >= g2.length ? g1 : g2
        let smaller = g1.length < g2.length ? g1 : g2

        // One loop over the larger genome also covers every gene of the smaller one (i < smaller.length).
        // The spread keeps whatever the other genome already put at that innovation.
        // x is a string, but "193" used as an array index is the same as 193.
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
    // Called by generateNewPopulation() step 6 with two reproducers of the same species (possibly the same
    // network twice). net1, net2 are NeuralNetworks, id is "species_child" (the generation is prefixed here).
    // Returns a new NeuralNetwork whose matrices are NOT built yet (generateNewPopulation mutates it first,
    // then calls generateNetwork()). Its score starts at 0.
    // Rules, as in NEAT:
    //   - matching genes (same innovation in both): taken from either parent, 50/50 per gene, so the child
    //     can mix weights (and enabled bits) of both parents
    //   - disjoint and excess genes: taken only from the fitter parent, so the child has exactly the
    //     fitter parent's structure. On equal scores the larger genome counts as fitter
    // Example: larger (score 80) has innovations 1 2 3 5, smaller (score 120) has 1 2 4.
    //   Smaller is fitter, so the child gets 1 and 2 from a coin flip each, plus 4 (from smaller). 3 and 5
    //   (larger only) are dropped. The child's genes come out sorted by innovation number.
    // Crossing a network with itself gives an exact copy (every gene is matching, both sides identical).
    // NOTE: "larger" means more genes, which isn't always the more complex network (disabled genes count too).
    // NOTE: the same from -> to connection added separately by two networks has two different innovation
    // numbers (see step 7 of generateNewPopulation), so here it counts as two unrelated genes.
    function crossover(net1, net2, id) {
        let larger = net1.getGenome().length >= net2.getGenome().length ? net1 : net2
        let smaller = net1.getGenome().length < net2.getGenome().length ? net1 : net2
        let lOverS = larger.getScore() >= smaller.getScore() // Is the larger genome the fitter parent (ties: yes)
        let alignedGenes = alignGenes(larger.getGenome(), smaller.getGenome())
        let genes = []

        for (let i = 0; i < alignedGenes.length; i++) {
            let l = alignedGenes[i]?.["l"], s = alignedGenes[i]?.["s"]
            if (!!l && !!s) { // If both contain same gene, select random
                genes.push(Math.round(Math.random()) ? l : s) // Math.round(Math.random()) is a coin flip, 0 or 1
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

        // generations was already bumped by advanceGeneration, so the id names the child's generation
        return NeuralNetwork(genes, bias, activation, outputActivation, `${generations}_${id}`, getGlobalInfo, gpuMultiplication, protectedInnovations)
    }

    // Returns the index of the most recent network assigned to a sim
    // (i.e. currentNet, shared by all games, not tied to one sim). Exported but not used outside this file.
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
    // More precisely: every network has been handed out. The last few may still be playing, so
    // simulationenvironment.js also checks that every game is idle before advancing.
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
            GamesPerNetwork: gamesPerNet,
            SurvivalBonus: survivalBonus,
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
    // The actual number of networks, which can differ a little from PopulationSize (see step 4 of generateNewPopulation)
    function getPopulationSize()
    {
        return population.length
    }

    // Returns entire population of neural networks
    // A shallow copy: sorting it is safe, but the networks inside are the live objects
    function getPopulation() {
        return [...population]
    }

    // Returns speciated population
    // As lists of genomes. These are the species from the last generateNewPopulation, i.e. the grouping of the
    // generation that bred the current population (and is empty during generation 0).
    function getSpecies() {
        return [...species]
    }

    // Returns the last finished generation grouped by species, or null during generation 0:
    //   { generation, species: [{ networks: [{ network, fitness, elite }], average, best, children }] }
    // Species are sorted best average first, and the networks in each best fitness first. generation counts from 0,
    // children is how many children the species was given for the next generation (elites not included)
    function getLastGeneration() {
        return lastGeneration
    }

    // Returns the id for a specific sim's network
    // "generation_index" for generation 0 and "generation_species_child" after that (elites keep their old id)
    function getCurrentNetId(sim) {
        return population[simCurrentNets[sim]]?.getId()
    }

    // Returns the score for a specific sim's network
    function getCurrentNetScore(sim) {
        return population[simCurrentNets[sim]].getScore()
    }

    // Public interface. Everything else above is private to this closure.
    return {
        "finishGame" : finishGame,
        "hasNetwork" : hasNetwork,
        "getCurrentGameNumber" : getCurrentGameNumber,
        "moveToNext" : moveToNext,
        "advanceGeneration" : advanceGeneration,
        "getNetworkAt" : getNetworkAt,
        "getPopulation" : getPopulation,
        "getSpecies" : getSpecies,
        "getLastGeneration" : getLastGeneration,
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