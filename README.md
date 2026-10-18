# PacManAI

A browser Pac-Man where a population of small neural networks learns to play by evolution. There are no hand-written strategies and no gradient descent. Networks play, the better ones breed, and over many generations they get better at clearing the board and staying away from ghosts.

The networks are evolved with **NEAT** (NeuroEvolution of Augmenting Topologies). NEAT evolves a network's *structure* (which nodes exist and how they're wired) along with its weights, starting from networks with no connections at all.

The game is a stripped-down version of [daleharvey/pacman](https://github.com/daleharvey/pacman), reworked so many games can run side by side and fast, with or without drawing. The project started in 2018 with a fixed-size network and a plain genetic algorithm, and was rebuilt around NEAT from 2022 on.

**Contents**
- [Running it](#running-it)
- [How it fits together](#how-it-fits-together)
- [The game the networks play](#the-game-the-networks-play)
- [What a network sees and does](#what-a-network-sees-and-does)
- [What NEAT is](#what-neat-is)
- [The genome](#the-genome)
- [Feedforward: running an evolved network](#feedforward-running-an-evolved-network)
- [The genetic algorithm: one generation](#the-genetic-algorithm-one-generation)
- [Training in stages](#training-in-stages)
- [Configuration](#configuration)
- [The training page](#the-training-page)
- [Saving and seeding networks](#saving-and-seeding-networks)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## Running it

You need [Deno](https://deno.land/) (the server is tiny and has no other dependencies).

```sh
cd PacManSimplified
deno task start
```

Then open <http://localhost:8000/index.html>. Training starts straight away.

`deno task start` runs `deno run --allow-net --allow-read --allow-write=ai/seeds entry.js`. The write permission is only for saving networks to `ai/seeds`. Start the server from `PacManSimplified/`, since file paths are relative to it. A different port can be passed as an argument: `deno task start 8001`.

The page loads [math.js](https://mathjs.org/) and [d3](https://d3js.org/) from CDNs, so the first load needs an internet connection, and math.js takes a few seconds to start up.

---

## How it fits together

```
simulationenvironment.js        runs training: config, the clock, generations, saving
        │ creates SimNum games, all sharing one trainer
        ▼
game.js  (one Game per canvas)  plays Pac-Man, builds the network's inputs each move,
        │                        reports each finished game's score
        ▼
ai/aiTrainer.js                 NEAT: hands networks to games, collects fitness,
        │                        speciates, breeds and mutates the next generation
        ▼
ai/neuralNetwork.js             one genome: builds its matrices, runs it, mutates it
```

Each generation:

1. **Play.** `SimNum` games run side by side, and each plays one network at a time from the population. When a network has played `GamesPerNetwork` games, its fitness is set and the game moves on to the next network that hasn't played yet.
2. **Breed.** Once every network has a fitness, the trainer builds the next generation: speciation, fitness sharing, culling, elitism, crossover and mutation (see [the genetic algorithm](#the-genetic-algorithm-one-generation)).
3. **Repeat** until `MaxGens` generations have run. The final population is saved to `ai/seeds`.

---

## The game the networks play

The rules are Pac-Man's, simplified for training:

- **One life.** A game ends when Pac-Man dies, starves, or clears the board.
- **Starvation.** If Pac-Man goes `StarveSeconds` (3 by default) seconds of game time without eating, the game ends. This stops networks from wandering or dithering forever.
- **Clearing the board ends the game** (it counts as a win) instead of moving on to level 2.
- **Ghosts wander or chase.** By default, a ghost takes random turns at junctions. With **Chasing ghosts** ticked on the page, ghosts head for Pac-Man instead, turning toward him at each junction that allows it. While eatable or eaten, ghosts always wander, like the arcade game's frightened ghosts. The chase is simpler than the arcade's individual ghost personalities, and ghosts are half Pac-Man's speed, so they catch him by cutting him off rather than from behind.
- **Scoring:** 10 per pellet, 50 per power pill, and 50, 100, 150… for the 1st, 2nd, 3rd… ghost eaten after a power pill.
- **Power pills** make the ghosts eatable for 8 seconds, flashing for the last 3. An eaten ghost turns grey and is harmless for 3 seconds.

**Training modes**, picked on the page and applied from the next generation:

| Mode | Ghosts | Power pills |
|---|---|---|
| Pellets only | none | none |
| Ghosts | `GhostCount` (1–4) | none |
| Power pill | `GhostCount` (1–4) | yes, on maps that have them |

**Maps**, picked with `MapIndex`. All are 19 × 22 tiles:

| # | Name | Pellets | Notes |
|---|---|---|---|
| 0 | Classic, 2 tunnels | 189 | |
| 1 | Default | 182 | the classic layout, hand-drawn walls |
| 2 | Classic variant | 205 | |
| 3 | Winding maze | 145 | no ghost house, no power pills |
| 4 | Open arena | 303 | almost no walls, no power pills |
| 5 | Twin tunnels | 172 | after Ms. Pac-Man's first maze, two tunnels a side |
| 6 | Side loops | 187 | after the arcade maze's lower half, pellet loops beside the ghost house |

Positions are in pixels, 10 px per tile. Pac-Man moves 2 px per tick and ghosts move 1 px, so Pac-Man is twice as fast.

**Game time.** Every timer (starvation, the survival bonus, ghost timers) counts in game seconds of 150 ticks (`TICKS_PER_SECOND`). That's fixed, so training behaves the same however fast the games are shown. The **Speed** control on the page only changes how many ticks run per real second while rendering: 1× is 150 ticks a second, and 0.2× is the original game's pace of 30. Headless runs ignore it and go as fast as the machine allows.

---

## What a network sees and does

### Outputs: moves relative to Pac-Man's heading

A network has 4 outputs: **straight, turn right, turn around, turn left**. These are relative to the way Pac-Man is facing, not absolute directions. The game converts the network's choice to an absolute direction with `(output + currentDirection) % 4`.

Relative moves mean the network learns one rule that works facing any way. "A pellet straight ahead → go straight" is a single behaviour, rather than four separate ones for up, down, left and right.

With `DecideOnTileCenter` on, the network only picks a move when Pac-Man is centred on a tile (every 5 ticks), and keeps going in between. This stops a network from reversing back and forth on the spot and cuts network evaluations by about 3×.

### Inputs: four numbers per kind of thing, one per direction

Inputs come in groups of 4, always in the same order as the outputs: **front, right, back, left** relative to Pac-Man. Input *i* and output *i* therefore talk about the same direction.

| Group | Inputs | Value |
|---|---|---|
| Open space (always on) | 4 | 1 if the neighbouring tile in that direction is walkable, else 0 |
| Pellets | 4 | proximity of the nearest pellet down that path |
| Ghosts | 4 | proximity of the nearest dangerous ghost down that path |
| Power pills | 4 | proximity of the nearest power pill down that path |
| Vulnerable ghosts | 4 | proximity of the nearest eatable ghost down that path |

**Proximity** is `max(0, 1 − d / 10)`, where `d` is the **walking distance through the maze**, not a straight-line distance. A value of 1 means right next to Pac-Man; 0 means nothing within 10 tiles that way.

For each direction, a search starts from the neighbouring tile with Pac-Man's own tile blocked, so a search can't loop back around behind him. The same ghost can show up in two directions if it sits on a loop that both paths lead to, which is correct, since it really is reachable both ways.

**Which groups are used is set with `InputSignals`.** They can only be added in order: pellets, then ghosts, then power pills, then vulnerable ghosts. That way a later training stage only appends inputs at the end, and networks from an earlier stage stay compatible (see [training in stages](#training-in-stages)). With pellets only, a network has 8 inputs; with all four groups, 20.

### Fitness

For each game:

```
game fitness = score + SurvivalBonus × (seconds alive up to the last pellet eaten)
```

A network's fitness is the **average** over its `GamesPerNetwork` games. Averaging matters once ghosts are on: ghosts are random, so a single game is partly luck. The survival bonus only counts time up to the last pellet, so stalling until starvation earns nothing.

---

## What NEAT is

NEAT ([Stanley & Miikkulainen, 2002](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)) is a genetic algorithm for neural networks that evolves the network's structure as well as its weights. It rests on three ideas:

1. **Start minimal and grow.** Networks begin with no hidden nodes (here, with no connections at all). Mutations add connections and nodes over time, so structure only appears when it helps. This is called complexification.

2. **Track genes with innovation numbers.** Every new connection anywhere in the population gets the next number from one global counter. Two networks that both inherited connection #193 share that gene, even if their structures have since drifted apart. Crossover and speciation line genomes up by innovation number, which makes it possible to combine two networks with different shapes.

3. **Protect new ideas with speciation.** A freshly mutated structure is usually worse at first, because its new weights haven't been tuned. NEAT groups similar networks into **species**, and networks mostly compete within their own species. Fitness is also shared within a species, so one big species can't take over the population. That gives new structures a few generations to improve before they have to compete with everything else.

---

## The genome

A network is stored as a list of **genes**, one per connection, each a string:

```
"innovation.from.to.weight.enabled"      e.g. "193.4.0.92.1"
```

| Field | Meaning |
|---|---|
| innovation | global innovation number of this connection |
| from, to | node numbers |
| weight | weight × 100, as an integer (92 = 0.92) |
| enabled | 1, or 0 for a disabled connection (kept for crossover, ignored when running) |

**Node numbers are shared by the whole population:** outputs first, then inputs, then hidden nodes in the order they were ever created. With 4 outputs and 8 inputs:

```
0  1  2  3 | 4  5  6  7  8  9 10 11 | 12 13 14 ...
 outputs   |        inputs           | hidden nodes
```

Because numbering is global, node 12 means the same node in every genome that has it.

A saved network (`ai/seeds/net_N.txt`) is JSON: a header recording `innovations.inputs.hidden.outputs.` at the time of saving, then the genes, then the network's fitness:

```json
["7819.12.1141.4.", ["26.10.2.2.1", "52.5.3.-1.1", "209.8.0.-100.1", ...], 1957.1]
```

The last element is the network's fitness. Older files don't have it, and they still load.

---

## Feedforward: running an evolved network

NEAT networks have no fixed layers. A hidden node can feed another hidden node, which can feed an output, and mutation can even create loops. The usual way to evaluate such a network is to sort the nodes so each comes after everything that feeds it (a topological sort). This project does something different: it uses **complex numbers to keep track of which nodes are ready**, and evaluates everything with matrix multiplications ([`ai/neuralNetwork.js`](PacManSimplified/ai/neuralNetwork.js)).

### Building the matrices

From the enabled genes, `generateNetwork()` builds:

- `maskOrder`: every node with at least one outgoing connection (inputs and hidden nodes that feed something), in node order. It's the row and column order of the matrices.
- `networkMatrix` (square): the weight from each node to each hidden node.
- `outputMatrix`: the weight from each node to each of the 4 outputs.

### The mask

`mask` holds one value per node in `maskOrder`. Input nodes hold the input values. Hidden nodes start as the imaginary unit **`i`**, which here means "not computed yet".

### The passes

1. Multiply the mask (as a row) by `networkMatrix`. That gives every hidden node the weighted sum of its inputs.
2. If a hidden node's sum has **no imaginary part**, every node feeding it is already known, so it's ready. Its value becomes `tanh(sum + bias)`, a real number, in the mask.
3. Repeat until no `i`s are left. Each pass resolves at least the next layer, so this computes the nodes in dependency order without ever sorting them.
4. Multiply the finished mask by `outputMatrix`, add the bias, apply softmax, and take the largest of the 4 outputs as the move.

**Example.** Inputs `a` and `b`, hidden nodes `h1` and `h2`, with `a → h1 (0.5)`, `b → h1 (1.0)`, `h1 → h2 (2.0)` and `h2 → straight (1.0)`:

```
start:   mask = [a, b, i, i]                     (a, b, h1, h2)
pass 1:  h1 = 0.5a + 1.0b              real → h1 = tanh(0.5a + b + bias)
         h2 = 2.0 · i                  imaginary → not ready
pass 2:  h2 = 2.0 · h1                 real → h2 = tanh(2·h1 + bias)
done:    output "straight" = 1.0 · h2 + bias → softmax → the largest output wins
```

**Loops.** A node in a loop never gets a real sum. After as many passes as there are nodes, any remaining imaginary parts are dropped and those nodes are computed from whatever is known. This keeps loops from hanging, but they don't behave like true recurrent connections.

**Caveats.**
- If two unresolved inputs to a node have weights that cancel (`+w·i − w·i = 0`), the node looks ready too early.
- Each pass is a full complex-number matrix multiply in math.js, which is slower than one pass in sorted order.
- The bias is a single shared constant (`Bias`), not evolved per node. On the outputs it has no effect, because softmax ignores a value added to every output.

The visualizer ([`ai/networkVisualizer.js`](PacManSimplified/ai/networkVisualizer.js)) uses the same trick to decide each node's column: a node's layer is the pass in which it was resolved.

---

## The genetic algorithm: one generation

All of this is `generateNewPopulation()` in [`ai/aiTrainer.js`](PacManSimplified/ai/aiTrainer.js), and runs once every network has a fitness.

### 1. Speciation

Each network joins the **first** species whose representative (a random member from last generation) is close enough. If none is, it founds a new species. Closeness is NEAT's **compatibility distance**:

```
δ = (c1 · E + c2 · D) / N  +  c3 · W̄
```

- **E** is the number of *excess* genes: innovations past the end of the other genome's range.
- **D** is the number of *disjoint* genes: innovations missing from the other genome but inside its range.
- **W̄** is the average weight difference of the genes both genomes share.
- **N** is the number of genes in the larger genome.

A network joins a species when `δ < threshold`. Lower `c3` or a higher threshold gives fewer, bigger species.

### 2. Elitism

The best network of every species with 5 or more members is copied into the next generation **unchanged**: no crossover, no mutation. That way a good network can't be lost to one unlucky batch of children.

### 3. Fitness sharing: how many children each species gets

Each network's adjusted fitness is its fitness divided by its species' size, so a species' adjusted fitnesses add up to its **average** fitness. The free slots (`PopulationSize` minus the elites) are shared out in proportion to those averages:

```
children of species s = round( average(s) / Σ averages × free slots )
```

So a small species with a high average can grow fast, and a large mediocre one shrinks. If every fitness is 0, each species keeps its current size.

### 4. Culling

Within each species, only networks at or above the `ReproductionPercentile` of the species' fitnesses become parents. With `0.8`, that's roughly the top 20%.

### 5. Crossover

Each child picks two random parents from its species' survivors (possibly the same one twice, which makes a clone). Their genes are lined up by innovation number:

- **Genes both parents have:** the child takes one, 50/50.
- **Genes only one parent has** (disjoint or excess): the child takes them only from the fitter parent. On a tie, they come from the one with more genes.

### 6. Mutation

**Weights.** Each gene of each child mutates with chance `WeightMutationR`:
- 90% of the time it's **nudged** by a normal random amount (standard deviation 0.2), and kept within [−3, 3].
- 10% of the time it's **replaced** with a new random weight in [−1, 1].

Nudging lets good networks be fine-tuned; the occasional replacement keeps the search from getting stuck.

**Structure.** With chance `StructureMutationR`, a child gets one structural mutation, which is one of:
- **Add a node.** A connection `A → B` is disabled, and two new ones replace it: `A → new` (weight 1) and `new → B` (the old weight). The network starts out behaving almost the same, and the new node gives evolution something to build on.
- **Add a connection.** A random pair of nodes that aren't connected yet gets a connection with a random weight in [−1, 1].

Which one happens is set by `StructureMutationSplit`, the chance of adding a node. At −1 it's **dynamic**: the chance is `DynamicSplitFactor × (connections / possible connections)`. Sparse networks mostly gain connections, and nodes appear more often as a network fills up.

Every new connection takes the next global innovation number. Finally, every child's matrices are built, and the children plus the elites form the next population.

---

## Training in stages

Learning everything at once (eat, dodge random ghosts, chase blue ghosts) gives a very noisy fitness signal. Training works better in stages, each seeded from the last:

1. **Pellets only**, with the pellet inputs: learn to move around the maze and clear it.
2. **Ghosts**, adding the ghost inputs: learn to avoid them. Start with 1 ghost and add more as the average score levels off.
3. **Power pill**, adding the power pill and vulnerable ghost inputs: learn when to chase.

Move on when the average score has levelled off for a few generations and the best networks clearly do the job. Don't wait for the whole population to be perfect.

To start a stage from the previous one's networks, save them, then in the config editor set:
- **Input signals** one step further,
- **Seed networks** to the number saved (e.g. 200),
- **New inputs** to 4 (one group of 4 added),
- optionally **Protect structure**, so the seeded connections aren't split while the new inputs get wired in.

New inputs start with no connections, so `StructureMutationR` matters most at the start of a new stage.

---

## Configuration

Training is configured in the `config` object at the top of [`PacManSimplified/simulationenvironment.js`](PacManSimplified/simulationenvironment.js), or through the **Config** button on the page. Saving the config restarts training from generation 1.

"Start" is the value in that config object. "If omitted" is what the code falls back to when an option is left out.

### Population

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `SimNum` | 10 | 1 | Games running side by side |
| `PopulationSize` | 200 | 1 | Networks per generation |
| `MaxGens` | 40 | 1 | Training stops after this many generations and saves the population |

### Inputs and network

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `InputSignals` | pellets | open space only | Which input groups the networks get, in order: pellets, ghosts, pills, vulnerable ghosts. The input count is worked out from this |
| `Outputs` | 4 | 0 (must be set) | Straight, right, back, left |
| `FullyConnected` | false | true | `true`: generation 0 starts with every input connected to every output. `false`: no connections at all, so everything is grown |
| `Bias` | — | 1 | Constant added to every node before activation |

### Mutation

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `WeightMutationR` | 0.65 | 0.25 | Chance per gene of a weight mutation (90% nudge, 10% replace) |
| `StructureMutationR` | 0.2 | 1 | Chance per child of one structural mutation |
| `StructureMutationSplit` | — | −1 | Chance a structural mutation adds a node rather than a connection. −1 = dynamic |
| `DynamicSplitFactor` | 0.8 | 1 | With the dynamic split: multiplier on connections ÷ possible connections. Lower keeps adding connections for longer |

### Speciation and reproduction

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `Compatibility.c1` | 1 | 1 | Weight of excess genes in δ |
| `Compatibility.c2` | 1 | 1 | Weight of disjoint genes in δ |
| `Compatibility.c3` | 0.2 | 1 | Weight of the average weight difference in δ |
| `Compatibility.threshold` | 1.8 | 1 | Networks closer than this to a species' representative join it |
| `ReproductionPercentile` | 0.8 | 0.5 | Only networks at or above this percentile of their species become parents |

### Fitness

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `GamesPerNetwork` | 3 | 1 | Games each network plays; its fitness is their average. Use 1 in pellets mode, where games are identical |
| `SurvivalBonus` | 10 | 0 | Points per second alive, counted up to the last pellet eaten (a pellet is 10) |

### Game

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `MapIndex` | 1 | 1 | Which map is played (see [maps](#the-game-the-networks-play)) |
| `GhostCount` | 1 | 4 | Ghosts in the Ghosts and Power pill modes |
| `DecideOnTileCenter` | true | false | Only ask the network for a move when Pac-Man is centred on a tile |
| `StarveSeconds` | 3 | 3 | Game seconds without eating before Pac-Man starves and the game ends |

### Seeding

| Option | Start | If omitted | Meaning |
|---|---|---|---|
| `SeedNumber` | — | 0 | How many networks to load from `ai/seeds` into generation 1 (0 = start from scratch) |
| `NewInputs` | — | 0 | Inputs added on top of the seeded networks. They start unconnected |
| `ProtectStructure` | — | false | Never split the connections loaded from the seeds |

`GPUMultiplication` also exists but doesn't work (its gpu.js import is commented out).

### Constants in the code

| Constant | Value | Where |
|---|---|---|
| Input search range | 10 tiles | `MAX_SEARCH_DISTANCE` in `objects/definitions.js` |
| Game second | 150 ticks | `TICKS_PER_SECOND` in `objects/definitions.js` |
| Lives | 1 | `initUser` in `objects/user.js` |

---

## The training page

- **Status bar:** the generation, how many networks have played, and the best fitness so far this generation.
- **Mode:** Pellets only, Ghosts, or Power pill. A change applies from the next generation.
- **Pause** (or the P key).
- **Chasing ghosts:** ghosts head for Pac-Man instead of wandering (in the Ghosts and Power pill modes). Like the mode, a change applies from the next generation, so every network in a generation faces the same kind of ghosts. The generation list marks those generations "chasing".
- **Speed:** how fast games play while rendering, from 0.2× (the original game's pace) to 4×. It applies straight away and doesn't affect training. At high speeds the machine may not keep up.
- **Headless:** stops drawing and runs the simulation as fast as possible, with progress bars and a ticks-per-second readout. Training keeps running at its normal pace in a background tab either way.
- **Save networks:** writes the current generation to `ai/seeds`.
- **Config:** opens the config editor. Saving it restarts training.
- **Simulations:** one canvas per game, labelled with the network and game number being played.
- **Population by species:** the generation that just finished, split into its species. Each species is a row that scrolls sideways, with its size, average and best fitness, and how many children it was given for the next generation. Species are ordered best average first and networks best first. Each card is a diagram of one network, inputs on the left and outputs on the right, with its fitness and an "Elite" badge if it was carried over unchanged. Loops are drawn as a ring. During the first generation, nothing has been scored yet, so the current population is shown in one row.
- **Generations:** the average and top fitness of each finished generation, with how long it took.

---

## Saving and seeding networks

**Save networks** (or the end of a training run) saves the **last finished generation**, sorted **best fitness first**. The networks currently playing haven't been scored yet, so they aren't the ones saved. The server **deletes every `net_N.txt` in `ai/seeds`** and writes `net_0.txt` (the best network), `net_1.txt`, … Each file also stores that network's fitness. Because the files are in rank order, **Seed networks = N loads the top N**. During the first generation nothing has been scored yet, so saving then writes the current, unscored population in its original order. `ai/seeds` is a working folder and is git-ignored.

Populations worth keeping go in **`ai/training_runs/`**, which is committed, one folder per training run with a folder per stage inside it. For example, `10_16.17_25-10_vision_depth/` holds a run's `pellets_only_2000max_1200avg` (pellets only, top fitness 2000, average 1200), `ghosts_80gens_1909max_962avg` and `allsignals_50gens_2952max_1610avg` stages. To use one:

```sh
cd PacManSimplified
cp ai/training_runs/10_16.17_25-10_vision_depth/pellets_only_2000max_1200avg/* ai/seeds/
```

Then, in the config editor, set **Seed networks** to 200 and **Input signals** to match the networks: "+ Pellets" for this one. If the seeds' input count plus **New inputs** doesn't match the selected inputs, training refuses to start and says why.

`visualize.html` is meant to draw the networks saved in `ai/seeds`, but it's currently broken (see [known limitations](#known-limitations)). The training page's **Population by species** panel shows the same diagrams.

---

## Project layout

```
PacManSimplified/
├── index.html                  the training page (layout and styles)
├── simulationenvironment.js    training loop: config, clock, headless mode, generations, saving
├── game.js                     one game: state machine, network inputs, fitness hand-off
├── dialogs.js                  config editor, confirmations, toasts
├── entry.js                    Deno server: static files + /api/seeds (count, save)
├── deno.json                   `deno task start`
├── ai/
│   ├── aiTrainer.js            NEAT population: speciation, fitness sharing, crossover, elitism
│   ├── neuralNetwork.js        a genome: matrices, the complex-number forward pass, mutation
│   ├── networkVisualizer.js    d3 diagrams of networks
│   ├── seeds/                  working folder for saved networks (git-ignored)
│   └── training_runs/          populations kept on purpose, by run and stage
├── objects/
│   ├── definitions.js          constants, the maps, power pill spots, wall drawing
│   ├── map.js                  the board: tiles, eating, drawing
│   ├── user.js                 Pac-Man: movement, turning, eating, score
│   └── ghost.js                ghosts: random movement, vulnerable and eaten states
├── visualize.html / .js        viewer for the networks in ai/seeds (currently broken)
└── old/                        the original single-file game, unused
AI/                             the 2018 fixed-network version, unused
```

The code is heavily commented. The NEAT steps in `aiTrainer.js` and the forward pass in `neuralNetwork.js` have worked examples, and known quirks are marked with `NOTE:` comments.

---

## Known limitations

- **Simple ghost AI.** Chasing ghosts use one greedy rule (turn toward Pac-Man), not the arcade's four ghost personalities, so avoidance learned against them won't fully transfer to the real game.
- **Inputs only reach 10 tiles.** Late in a level, pellets further away read as 0, so clearing the last few pellets is partly luck.
- **Mid-tile reactions.** With `DecideOnTileCenter` on, networks only learn to decide at tile centres. Turning it off after training makes them decide every tick, which they haven't practised. Train the last stage with it off if you want that.
- **No shared innovation numbers within a generation.** Two children that add the same connection in the same generation get different innovation numbers; original NEAT gives them the same one.
- **The population size can drift by a few** from `PopulationSize`, because each species' share is rounded separately.
- **The forward pass** has the caveats described [above](#feedforward-running-an-evolved-network).
- **`visualize.html` doesn't work.** It imports `simulationenvironment.js`, whose page setup expects the training page's buttons and throws before anything is drawn.

---

Game based on [daleharvey/pacman](https://github.com/daleharvey/pacman). NEAT as described by Kenneth O. Stanley and Risto Miikkulainen, [*Evolving Neural Networks through Augmenting Topologies*](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf) (2002).
