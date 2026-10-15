# PacManAI: Codebase Summary

## What it is
A browser-based Pac-Man where a population of small neural networks learns to play through **neuroevolution**. The project started in Oct 2018 with a fixed-layout network and a genetic algorithm. It was picked back up in Aug–Dec 2022, when the AI was rewritten to use **NEAT** (NeuroEvolution of Augmenting Topologies). With NEAT, the network's structure (which nodes exist and how they connect) evolves along with its weights. The game itself is a stripped-down copy of [daleharvey/pacman](https://github.com/daleharvey/pacman).

There are 17 commits. The last one is `182fbd8 "dynamic split, new inputs, protect structure"` from 2022-12-23. About 630 lines of changes after that were never committed, mostly in `game.js` and `definitions.js`.

## Layout
| Path | Role |
|---|---|
| [AI/](AI/) | **The 2018 version, no longer used.** Fixed network design in [AIDesign.txt](AI/AIDesign.txt): 428 inputs (whole map plus positions), 3 hidden layers of 12, 4 outputs. |
| [PacManSimplified/old/pacmanSimple.js](PacManSimplified/old/pacmanSimple.js) | The original one-file game before it was split into modules. No longer used. |
| [entry.js](PacManSimplified/entry.js) | A small Deno static file server on port 8000 |
| [index.html](PacManSimplified/index.html) | Page with a grid of game canvases, a sidebar of per-generation stats, and a network visualization area |
| [simulationenvironment.js](PacManSimplified/simulationenvironment.js) | **Main driver.** Holds the training settings, starts N games, checks every 15 seconds whether the generation is done, then logs results, moves to the next generation and saves genomes. |
| [game.js](PacManSimplified/game.js) | Game loop. Each tick it builds the network's inputs (`getInput*`), asks the AI for a move and reports the score. |
| [objects/](PacManSimplified/objects/) | `user.js` (Pac-Man), `ghost.js`, `map.js`, `definitions.js` (constants, map layouts, wall generation) |
| [ai/aiTrainer.js](PacManSimplified/ai/aiTrainer.js) | NEAT population manager: species, crossover, mutation, global innovation counter |
| [ai/neuralNetwork.js](PacManSimplified/ai/neuralNetwork.js) | One genome and its forward pass |
| [ai/networkVisualizer.js](PacManSimplified/ai/networkVisualizer.js), [visualize.js](PacManSimplified/visualize.js) | Draw networks with d3 (not committed) |
| `ai/*.txt` | Saved genomes, e.g. `topnet_0_2390.txt` (presumably a top network that scored 2390) |

## How training works
1. **Setup** (config in `simulationenvironment.js`): 10 games run side by side, with 200 networks per generation for 40 generations. Each network has 6 inputs and 4 outputs, and the population starts with no connections (`FullyConnected: false`).
2. **Evaluation:** each game takes the next untested network from a shared queue (`moveToNext`). Pac-Man has 1 life. A network's fitness is its game score: 10 per biscuit, 50 per power pill.
3. **Decisions are relative to Pac-Man's heading.** The network picks one of 4 outputs: straight, right, turn around or left. The game converts that to a direction with `(output + currentDirection) % 4` (in `mainLoop` in `game.js`).
4. **Inputs:** the active `getInput()` in `game.js` gives the 4 neighbouring tiles (front, top, back, bottom, all relative to Pac-Man's heading) plus the distance and angle to the nearest biscuit. Ghost inputs are computed but turned off, and `ghostSpecs` is empty, so **the current setup trains with no ghosts**. `getInput1`, `getInput2` and `getInput3` are earlier experiments: nearest ghost, the whole 19×19 map, and so on.
5. **Next generation** (`generateNewPopulation`):
   - Networks are grouped into species using NEAT's compatibility distance (c1/c2/c3 coefficients and a threshold).
   - Fitness is shared within a species (divided by species size).
   - Each species gets a share of the next generation in proportion to its fitness.
   - Members below the reproduction percentile are dropped.
   - The rest are crossed over, then their weights and structure are mutated.

## Neural network internals (the unusual part)
- **Gene format:** `"innovation.fromNode.toNode.weight×100.enabled"`, e.g. `"193.4.0.92.1"`. Nodes are numbered with outputs first, then inputs, then hidden nodes.
- **Structural mutations:** either split an existing connection with a new node, or add a new connection. With "dynamic split", the chance of adding a node rises as the network gets more fully connected. "Protect structure" stops seeded genes from being split.
- **Forward pass** (`execute` in `neuralNetwork.js`): every hidden node starts as the imaginary unit `i` (via math.js complex numbers). The code repeatedly multiplies the node values by the connection matrix. A hidden node gets its activation as soon as its incoming sum is purely real, which means all of its inputs have been resolved. This evaluates any NEAT graph in the right order without an explicit topological sort. If the network has cycles, the loop stops after a set number of passes and just drops the imaginary part ("Lets use our imagination").
- Hidden nodes use tanh and the outputs use softmax. The highest output wins.

## How to run it
```
cd PacManSimplified
deno run --allow-net --allow-read entry.js
# open http://localhost:8000/index.html
```
Imports use absolute paths (`/ai/...`) and pull dependencies from CDNs (math.js, d3, deno.land/x/abc). The CDN imports may have broken since 2022: `dev.jspm.io` is deprecated, and that's what the math.js import uses. Check this first if the page doesn't load.

## Loose ends (as of the last session)
- **Code that will break if switched on:** the GPU path (`GPUMultiplication`) refers to a `gpu` object, but the gpu.js import is commented out. Seeding (`SeedNumber`) loads `ai/seeds/net_N.txt`, but that folder is gitignored and currently empty.
- **Uncommitted change:** finishing a level now ends that network's run and counts as a win, instead of moving on to level 2.
- **Leftover experiments:** lots of commented-out code (map switching per generation, suicide/stall timers, ghost inputs). The apparent plan was to train without ghosts first, then add ghost inputs on top of the evolved networks using `NewInputs` + `ProtectStructure`.
- **Stray files:** the `.DS_Store` files should go in `.gitignore`.
