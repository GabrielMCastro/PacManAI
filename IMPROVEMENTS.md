# PacManAI: Improvement Plan (10-14-26)

The furthest the project got (see `Demos/ok_runs.mov`): networks learn to move around the maze and eat pellets but never learn to avoid ghosts. This doc covers why, and the planned fixes. See [SUMMARY.md](SUMMARY.md) for how the code works.

**Conclusion: NEAT is not the problem.** It's a good fit for a task this size, with a handful of inputs and 4 outputs, and it has been applied to Pac-Man before. Gradient-based reinforcement learning (DQN/PPO) copes better with noisy rewards but wouldn't fix the problems below. The main problems are what the networks are shown (the inputs) and how they're scored (fitness).

---

## Why ghost avoidance never emerged

### 1. "No ghost nearby" looks the same as "ghost right in front of you"
`getInput1` in `game.js` gives the nearest ghost as `[distance, angle]`, but only if it's within 3.5 tiles. Otherwise it gives `[0, 0]`. With the angle convention used, `[0, 0]` means "ghost at distance 0, dead ahead". That's the most dangerous reading possible, and it's what the network sees most of the time. Smaller distances also mean more danger, so the inputs are weakest exactly when the danger is greatest.

### 2. The angle inputs jump at the directions that matter most
`atan2` angles jump from +π to −π at one direction.
- **Ghost** (vector from ghost to Pac-Man): the jump is **directly behind**, which is where a chasing ghost comes from.
- **Pellet** (vector from Pac-Man to pellet, the opposite convention): the jump is **directly ahead**. A pellet straight ahead reads as roughly +π or −π depending on a one-tile offset.

### 3. Straight-line distance ignores walls
A ghost 2 tiles away behind a wall is no threat. One 3 tiles down an open corridor is. Straight-line distance gets this backwards.

### 4. Fitness mostly measures luck
- Ghosts move randomly (`due = false ? chasePacman(...) : getRandomDirection()` in `ghost.js`).
- Each network plays one game with one life.

Early deaths come mostly from a ghost happening to wander into Pac-Man, so any small advantage from dodging is lost in the noise. Pellets give a steady reward that selection can see, which matches the observed behaviour.

### 5. Weight mutation throws weights away instead of adjusting them
`mutateWeights` replaces a weight with a new random value in [-1, 1]. Standard NEAT mostly adjusts weights by small random amounts. With full replacement, fine-tuning is almost impossible. This hurts the staged approach (`NewInputs` + `ProtectStructure`) the most:
- New ghost connections start at random, often large, weights and usually damage the pellet behaviour before they can help.
- Because of the noisy fitness, those changes rarely survive selection.

### 6. No elitism
Every child is crossed over and mutated, so the best network of a generation can be lost.

### 7. Eatable ghosts reverse what the ghost inputs mean
After a power pill, the same inputs mean "chase" instead of "flee". Switching behaviour on a single flag is hard for small evolved networks. Schrum & Miikkulainen's Ms. Pac-Man work on modular networks found that separate modules for different behaviours help with exactly this.

### Why it still learned pellets
Mostly from the tile inputs. A biscuit reads `2` and an empty tile reads `0.5`, in the same direction order as the outputs. "Move toward the neighbour reading 2" is almost a direct input-to-output mapping, and following trails of biscuits covers most of the maze.

The pellet angle isn't useless. Behind is about 0, right is about −π/2 and left is about +π/2, and those readings are smooth. Only "straight ahead" sits on the ±π jump, so it's the least reliable reading. The angle matters most late in a level, when no pellet is adjacent.

### A useful sanity check
Try writing a simple hand-coded rule that avoids ghosts using only the network's inputs. If you can't, the network can't either.

---

## Plan

### 1. Inputs

**Per-direction ghost danger.** Use one value for each direction instead of distance + angle:

```
ghostDanger[dir] = 1 - d/maxD   // d = maze distance to the nearest dangerous ghost if Pac-Man first steps in that direction
                                 // 0 if that direction is a wall or there's no ghost within maxD
```

- Run one breadth-first search from each open neighbouring tile, with `maxD ≈ 8` tiles.
- This covers both "no ghost" (0) and walls (maze distance).
- It sees ghosts around corners, which a straight-line check down the corridor would miss.
- The network doesn't have to learn to combine "close" and "in front"; one value says both.
- With this input, "don't step toward a direction with high danger" is a simple rule for evolution to find.

**Direction order:** the tile inputs are actually **[front, right, back, left]** (index 1 is `due + 1`, Pac-Man's right). The comment in `getInput()` saying "front, top, back, bottom" is wrong and should be fixed. That order matches the outputs (0 straight, 1 right, 2 back, 3 left). Use the same order for the ghost inputs, so input *i* and output *i* refer to the same direction.

**Pellets (optional but cheap):** use the same maze search to get the distance to the nearest biscuit in each direction. At minimum, switch the angle to `sin θ, cos θ`. Also scale the pellet distance: it currently goes up to about 25, while every other input is in the 0–5 range.

### 2. Reducing luck in fitness

- **Average each network's score over 3 games.**
  - `setScore` currently overwrites the score, so it needs to add up results across games.
  - `moveToNext` should only be called after the network's third game.
- **Survival bonus: hold off at first.** Pellets already reward survival indirectly. If one is needed:
  - Make it a small per-time bonus (e.g. +1 per second alive), clearly smaller than the eating rate. Don't multiply the total score, because that scales pellets and survival together.
  - It rewards stalling, and there's currently no time limit, so a hiding network would never end its game. Turn the `eatenTimer` idea in `user.js` back on: the game ends if no pellet is eaten in N seconds.
  - A one-off bonus for clearing the level is a cleaner reward.
- **Add elitism.** Copy each species' best network into the next generation unchanged (for species with more than about 5 members).

### 3. Nudging weights

- Most of the time, add Gaussian (bell-curve) noise to the weight (standard deviation ~0.2, or 20 in the ×100 encoding). Occasionally replace it entirely. Standard NEAT is roughly 90% nudge, 10% replace.
- Raise the per-gene mutation rate from `0.05` to about `0.5–0.8`, since each change is now small.
- Widen the allowed range to ±3. New random weights are still drawn from ±1.

```js
function gaussian() { // Box-Muller
    return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
}

function mutateWeights(rate) {
    for (let i = 0; i < genome.length; i++) {
        if (Math.random() < rate) {
            let dna = genome[i].split(".")
            if (Math.random() < .9) {
                let w = parseInt(dna[3]) + Math.round(gaussian() * 20)
                dna[3] = `${Math.max(-300, Math.min(300, w))}`
            } else {
                dna[3] = `${Math.floor(Math.random() * 201) - 100}`
            }
            genome[i] = dna.join(".")
        }
    }
}
```

### 4. Training stages

1. Pellets only (already works).
2. Ghosts: start with one random ghost, then all four, then chasing ghosts (`chasePacman` already exists in `ghost.js` but is turned off by `false ?`).
3. Power pill / eatable-ghost mode, once avoidance works.

**Worth trying first:** train from scratch with one ghost, using the new inputs. Per-direction danger may be simple enough to learn alongside pellet eating. That avoids the `NewInputs`/`ProtectStructure` seeding setup and the damage that new random connections do to an already-good pellet network.

---

## Forward-pass caveats (`neuralNetwork.js`)

These aren't the cause of the ghost problem, but they're worth knowing before changing the network code. The forward pass is non-standard. It marks hidden nodes as unresolved by setting them to the imaginary unit `i`, and activates a node once its incoming sum is purely real. It doesn't sort the nodes into evaluation order first, the way most NEAT libraries do.

- **Imaginary parts can cancel.** A node with two unresolved inputs weighted e.g. `+0.5` and `-0.5` looks resolved too early and gets activated without those inputs' real values. It's rare, but possible.
- **Speed:** it runs up to one full matrix multiply per layer of depth, using math.js complex numbers. That's much slower than a single pass with the nodes in sorted order.
- **Cycles:** the pass limit and the step that drops the imaginary part stop loops from hanging, but nodes inside a loop end up with fairly arbitrary values. It isn't true recurrent behaviour.

## Suggested order of work
1. Maze-search ghost danger inputs (and optionally pellet inputs).
2. Weight nudging + elitism.
3. Averaging fitness over 3 games, plus a stall timeout.
4. Train from scratch with one ghost; add ghosts, then chasing, then power pills.
