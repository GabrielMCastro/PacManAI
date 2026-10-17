/*
 * Shared constants and data for the game objects: key codes, directions, game states, tile values,
 * the maps (MAP, MAP_NAMES, POWER_PILLS) and the wall outlines drawn on top of them.
 *
 * Coordinates used across the game:
 *  - Maps are arrays of rows, so a tile is map[row][col] = map[y][x]. Every map is 19 wide by 22 tall.
 *  - Pacman and the ghosts store positions in tenths of a tile (10 units per tile, sometimes called "pixels"
 *    in comments elsewhere). Math.round(pos / 10) turns a position into a tile index (pointToCoord).
 *  - Wall outlines below are in tile units, with tile centres at +0.5 (the centre of tile (x 3, y 2) is [3.5, 2.5]).
 *  - Drawing multiplies tile units by blockSize, 342 / 19 = 18 canvas pixels per tile (set in game.js init()).
 */

/* Human readable keyCode index */
export var KEY = {'BACKSPACE': 8, 'TAB': 9, 'NUM_PAD_CLEAR': 12, 'ENTER': 13, 'SHIFT': 16, 'CTRL': 17, 'ALT': 18, 'PAUSE': 19, 'CAPS_LOCK': 20, 'ESCAPE': 27, 'SPACEBAR': 32, 'PAGE_UP': 33, 'PAGE_DOWN': 34, 'END': 35, 'HOME': 36, 'ARROW_LEFT': 37, 'ARROW_UP': 38, 'ARROW_RIGHT': 39, 'ARROW_DOWN': 40, 'PRINT_SCREEN': 44, 'INSERT': 45, 'DELETE': 46, 'SEMICOLON': 59, 'WINDOWS_LEFT': 91, 'WINDOWS_RIGHT': 92, 'SELECT': 93, 'NUM_PAD_ASTERISK': 106, 'NUM_PAD_PLUS_SIGN': 107, 'NUM_PAD_HYPHEN-MINUS': 109, 'NUM_PAD_FULL_STOP': 110, 'NUM_PAD_SOLIDUS': 111, 'NUM_LOCK': 144, 'SCROLL_LOCK': 145, 'SEMICOLON': 186, 'EQUALS_SIGN': 187, 'COMMA': 188, 'HYPHEN-MINUS': 189, 'FULL_STOP': 190, 'SOLIDUS': 191, 'GRAVE_ACCENT': 192, 'LEFT_SQUARE_BRACKET': 219, 'REVERSE_SOLIDUS': 220, 'RIGHT_SQUARE_BRACKET': 221, 'APOSTROPHE': 222};

// Deep copy, added to every object. Only used for WALLS at the bottom of this file.
// Copies every enumerable key (for...in, which also sees inherited keys, hence skipping 'clone' itself),
// recursing into nested objects and arrays. Inherited from the original daleharvey/pacman code.
// NOTE: Assigning to Object.prototype adds an enumerable "clone" key to every object and array in the page
// (including the NEAT code), so any for...in loop elsewhere would see it. No other for...in loops exist in
// the current code (outside old/), so it causes no problems at the moment.
Object.prototype.clone = function () {
    var i, newObj = (this instanceof Array) ? [] : {};
    for (var i in this) {
        if (i === 'clone') {
            continue;
        }
        if (this[i] && typeof this[i] === "object") {
            newObj[i] = this[i].clone();
        } else {
            newObj[i] = this[i];
        }
    }
    return newObj;
};

// Fill in the rest of KEY: digits, letters, number pad digits and function keys
(function () {
	/* 0 - 9 */
	for (var i = 48; i <= 57; i++) {
        KEY['' + (i - 48)] = i;
	}
	/* A - Z */
	for (var i = 65; i <= 90; i++) {
        KEY['' + String.fromCharCode(i)] = i;
	}
	/* NUM_PAD_0 - NUM_PAD_9 */
	for (var i = 96; i <= 105; i++) {
        KEY['NUM_PAD_' + (i - 96)] = i;
	}
	/* F1 - F12 */
	for (var i = 112; i <= 123; i++) {
        KEY['F' + (i - 112 + 1)] = i;
	}
})();

// Directions (NONE to RIGHT), the values themselves are arbitrary. The AI uses its own numbering,
// 0 = LEFT, 1 = UP, 2 = RIGHT, 3 = DOWN (clockwise), see user.js getDirection/setDirection.
// NONE is pacman's direction when it has stopped against a wall.
// NOTE: RIGHT = 11 looks odd next to 1 to 4, but it comes from the original daleharvey/pacman code.
// It doesn't collide with anything: it differs from the other directions and from NONE, and directions
// are never compared with the game states (5 to 10), which only live in game.js's `state`.
// Directions are only compared with each other, used as object keys (ghost eye offsets) or mapped to 0-3.
// Game states (WAITING to DYING), see game.js step(). PAUSE isn't used by game.js
export const NONE = 4,
    UP          = 3,
    LEFT        = 2,
    DOWN        = 1,
    RIGHT       = 11,
    WAITING     = 5,
    PAUSE       = 6,
    PLAYING     = 7,
    COUNTDOWN   = 8,
    EATEN_PAUSE = 9,
    DYING       = 10;

// Tile values used in the maps below. Eaten biscuits and pills are replaced with EMPTY (user.js move())
export const OBJECTS = {
    WALL : 0,     // Solid
    BISCUIT : 1,  // Pellet, 10 points
    EMPTY : 2,    // Walkable, nothing on it (also the tunnel tiles at the edges)
    BLOCK : 3,    // The ghost house. Not floor (nothing can turn into it, see map.js isFloorSpace) but not
                  // a wall either (something already heading into it isn't stopped, see isWallSpace)
    PILL : 4      // Power pill, 50 points and makes the ghosts eatable
}

// Unused alternative maps
// MAP2[0] is identical to MAP[1]. MAP2[1] is the same layout with most biscuits removed (13 left), probably
// an experiment with sparse pellets.
// NOTE: MAP2 is exported but nothing imports it.
export const MAP2 = [
[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1/*, 4*/, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1/*, 4*/, 0],
[0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
[0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 2, 1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1, 2, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 0, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 0, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
[0, 1/*, 4*/, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1/*, 4*/, 0],
[0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
[0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0],
[0, 2/*, 4*/, 0, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 0, 2, 0, 0, 2/*, 4*/, 0],
[0, 2, 0, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 0, 2, 0, 0, 2, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
[0, 2, 0, 0, 2, 0, 1, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 2, 0],
[0, 2, 2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 2, 0],
[0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0],
[2, 2, 2, 0, 2, 0, 2, 2, 2, 2, 2, 2, 2, 0, 2, 0, 2, 2, 2],
[0, 0, 0, 0, 2, 0, 2, 0, 0, 3, 0, 0, 2, 0, 2, 0, 0, 0, 0],
[2, 2, 2, 2, 2, 1, 2, 0, 3, 3, 3, 0, 2, 1, 2, 2, 2, 2, 2],
[0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0],
[2, 2, 2, 0, 2, 0, 2, 2, 1, 2, 2, 2, 2, 0, 2, 0, 2, 2, 2],
[0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0],
[0, 2, 0, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 0, 2, 0, 0, 2, 0],
[0, 2/*, 4*/, 2, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2/*, 4*/, 0],
[0, 0, 2, 0, 2, 0, 1, 0, 0, 0, 0, 0, 1, 0, 2, 0, 2, 0, 0],
[0, 2, 2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 2, 0],
[0, 2, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
]

// The maps, [row][col] of OBJECTS values, 19 wide by 22 tall. Picked by mapI in game.js (mapIndex option,
// default map 1), chosen in the config editor by name (MAP_NAMES). map.js reset() works on a copy.
// Power pills were commented out in place (1/*, 4*/), POWER_PILLS puts them back in the power pill mode.
// Every map has pacman's start (col 9, row 12) and the ghosts' start (col 9, row 8) on walkable tiles.
// EMPTY (2) tiles on the left and right edges are tunnels when they connect to the maze; pacman and the
// ghosts wrap from one side to the other there (user.js move(), ghost.js pane()). Some edge 2s are just
// closed-off pockets that can't be reached.
export const MAP = [
    // Map 0, Classic, 2 tunnels: tunnels on rows 7 and 14
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 1/*, 4*/, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1/*, 4*/, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0],
    [2, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 2],
    [0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0],
    [2, 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 2],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
    [2, 0, 1, 0, 0, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, 0, 1, 0, 2],
    [2, 0, 1, 0, 1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1, 0, 1, 0, 2],
    [2, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 2],
    [2, 0, 1, 1, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 1, 1, 0, 2],
    [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
    [2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2],
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2],
    [0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0],
    [0, 1/*, 4*/, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1/*, 4*/, 0],
    [0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
// Map 1, Default: the original daleharvey/pacman maze. One tunnel on row 10 (the 2s on rows 8 and 12 are
// closed off). Its walls are the hand-drawn testWalls rather than traceWalls
[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1/*, 4*/, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1/*, 4*/, 0],
[0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
[0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 2, 1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1, 2, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[2, 2, 2, 0, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 0, 2, 2, 2],
[0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
[0, 1/*, 4*/, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1/*, 4*/, 0],
[0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
[0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
   // Map 2, Classic variant: one tunnel on row 7, power pills in the corners of rows 2 and 19
   [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1/*, 4*/, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1/*, 4*/, 0],
    [0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
    [0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0],
    [2, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 2],
    [0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0],
    [0, 1, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 0, 1, 0, 3, 3, 3, 0, 1, 0, 1, 1, 1, 1, 0],
    [0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 0, 1, 0],
    [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
    [0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0],
    [0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 1/*, 4*/, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1/*, 4*/, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
// Map 3, Winding maze: twisty corridors, no ghost house, no tunnels and no power pills.
// The 2s here are closed-off pockets and short empty stretches
[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
[0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
[0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 2, 2, 2, 2, 0],
[0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 2, 2, 2, 2, 0],
[0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 2, 2, 0],
[0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 0],
[0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0],
[0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 2, 2, 2, 0, 1, 1, 0, 0, 0],
[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
[0, 0, 1, 1, 0, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 0, 0, 1, 0],
[0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0],
[0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0],
[0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0],
[0, 2, 0, 1, 0, 2, 2, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
[0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0],
[0, 2, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
[0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 2, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 1, 1, 0, 2, 2, 0],
[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],

// Map 4, Open arena: an open field of biscuits with no corridors, no ghost house, no tunnels and no power pills.
// The ghosts start on a biscuit at (9, 8). The 2s are empty patches inside the arena
[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 2, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
[0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 0],
[0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 0],
[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    // Map 5, Twin tunnels: after Ms. Pac-Man's first maze. Two tunnels a side and solid side blocks around the ghost house
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [2, 2, 2, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2],
    [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    // Map 6, Side loops: after the arcade maze's lower half and Ms. Pac-Man's third maze. Pellet loops either side of the ghost house, one low tunnel
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0],
    [0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 1, 0, 1, 0, 0, 3, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 0, 0, 1, 1, 1, 0, 3, 3, 3, 0, 1, 1, 1, 0, 0, 1, 0],
    [0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2],
    [0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
]

// [row, col] of the power pills for each map in MAP, placed in the "power pill" training mode
// (map.js reset() with powerPills set, replacing the biscuit there). Same order as MAP. Maps 3 and 4 have none,
// which the config editor (dialogs.js) points out in the map list
export const POWER_PILLS = [
    [[2, 1], [2, 17], [18, 1], [18, 17]],
    [[2, 1], [2, 17], [16, 1], [16, 17]],
    [[2, 1], [2, 17], [19, 1], [19, 17]],
    [],
    [],
    [[2, 1], [2, 17], [16, 1], [16, 17]],
    [[2, 1], [2, 17], [16, 1], [16, 17]],
]

// Names for each map in MAP, shown in the config editor (dialogs.js). Same order as MAP
export const MAP_NAMES = ["Classic, 2 tunnels", "Default", "Classic variant", "Winding maze", "Open arena", "Twin tunnels", "Side loops"]

// Builds the wall outlines drawn by map.js from a map's wall tiles, in the same style as the hand-drawn
// testWalls: thick lines through the middle of the wall tiles with rounded corners.
// Each wall tile draws half of the line to each wall tile next to it (a quarter curve when it's a corner),
// so the halves meet at the tile edges. Thick walls get an outline rather than a grid: a line between two wall
// tiles is skipped when there are walls on both sides of it. Lines that run into the edge of the board carry on
// to the edge, like the walls around the tunnels.
// Returns a list holding one path of {move}/{line}/{curve} points in tile coordinates
//
// Called by map.js reset() for every map except map 1 (which uses testWalls). The path is drawn by map.js
// drawWall() with a line width of half a tile and round caps, so the dots and line ends look rounded.
// It's all one path made of many short pieces, each starting with its own move.
//
// Worked example, a 3x3 block of wall (#) surrounded by floor (.), tile centres at col/row + 0.5:
//
//          col 0  1  2  3  4
//     row 0    .  .  .  .  .
//     row 1    .  #  #  #  .
//     row 2    .  #  #  #  .
//     row 3    .  #  #  #  .
//     row 4    .  .  .  .  .
//
//  - (row 1, col 1), top left: the line to the right (to col 2) is kept because the tiles above that pair are
//    floor; the line down (to row 2) is kept because the tiles left of that pair are floor. Nothing to the
//    left or up. One horizontal and one vertical end makes a corner: move to [2, 1.5] (middle of its right
//    edge) and curve, with the tile centre [1.5, 1.5] as control point, to [1.5, 2] (middle of its bottom edge).
//  - (row 1, col 2), top middle: left and right lines are kept, so two half lines from the centre [2.5, 1.5]
//    to [2, 1.5] and [3, 1.5]. They meet the halves drawn by cols 1 and 3. The line down to (row 2, col 2)
//    is skipped, it has walls on both sides (cols 1 and 3), so it would be inside the thick wall.
//  - (row 2, col 2), the centre: all four of its lines have walls on both sides and are skipped. It isn't a
//    lone tile either, so it draws nothing.
//  The result is one rounded square running through the centres of the outer ring of wall tiles.
//
// Edge rule: a wall at col 0 running right along a tunnel has no wall at col -1, so its left half would be
// missing and the line would stop with a rounded end at x = 0.5, leaving a gap at the board edge. If the tile
// has no vertical lines, the missing half is forced on so the line reaches x = 0 (likewise for the right edge,
// and for vertical lines at the top and bottom rows).
export function traceWalls(map) {
    let height = map.length, width = map[0].length
    // wall: in bounds and a wall tile. wallOrEdge also counts outside the board as wall, so a wall that is two
    // or more tiles deep at the board edge counts as thick and only its inner outline is drawn
    let wall = (r, c) => r >= 0 && r < height && c >= 0 && c < width && map[r][c] === OBJECTS.WALL
    let wallOrEdge = (r, c) => r < 0 || r >= height || c < 0 || c >= width || map[r][c] === OBJECTS.WALL

    // Line between (r, c) and the next tile to the right / below, skipped if it's inside a thick wall
    // (the two tiles on either side of the pair, above and below for lineRight, left and right for lineDown,
    // are all wall or off the board)
    let lineRight = (r, c) => wall(r, c) && wall(r, c + 1) &&
        !(wallOrEdge(r - 1, c) && wallOrEdge(r - 1, c + 1) && wallOrEdge(r + 1, c) && wallOrEdge(r + 1, c + 1))
    let lineDown = (r, c) => wall(r, c) && wall(r + 1, c) &&
        !(wallOrEdge(r, c - 1) && wallOrEdge(r + 1, c - 1) && wallOrEdge(r, c + 1) && wallOrEdge(r + 1, c + 1))

    let path = []
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (!wall(r, c)) continue
            // Which of this tile's four half lines to draw. Left/up reuse the neighbour's right/down check so
            // both tiles agree on whether the line between them exists
            let left = lineRight(r, c - 1), right = lineRight(r, c), up = lineDown(r - 1, c), down = lineDown(r, c)
            // Runs along a row or column that reach the edge of the board carry on to the edge
            if (!up && !down) {
                if (c == 0 && right) left = true
                if (c == width - 1 && left) right = true
            }
            if (!left && !right) {
                if (r == 0 && down) up = true
                if (r == height - 1 && up) down = true
            }

            let x = c + .5, y = r + .5
            let ends = []  // Where each half line ends, the middle of the tile's edge
            if (left)  ends.push([x - .5, y])
            if (up)    ends.push([x, y - .5])
            if (right) ends.push([x + .5, y])
            if (down)  ends.push([x, y + .5])

            if (ends.length == 0) {
                // A lone wall tile is a dot. A tile inside a thick wall has nothing to draw.
                // The dot is a 0.01 long line, its round caps make it a circle half a tile across
                let lone = !wall(r, c - 1) && !wall(r, c + 1) && !wall(r - 1, c) && !wall(r + 1, c)
                if (lone) path.push({ "move": [x, y] }, { "line": [x + .01, y] })
            } else if (ends.length == 2 && (left || right) && (up || down)) {
                // Corner, curve between the two edges. The tile centre is the control point, giving a quarter curve
                path.push({ "move": ends[0] }, { "curve": [x, y, ...ends[1]] })
            } else {
                // Straight line (1 or 2 ends in line) or a junction (3 or 4 ends): a half line from the centre to each end
                ends.forEach(e => path.push({ "move": [x, y] }, { "line": e }))
            }
        }
    }
    return [path]
}

// Old wall outline builder, no longer used (it draws stray diagonal lines on some maps). Starting from every tile it follows
// runs of walls right and down, and starts new lines where walls branch (see isJoint).
// Returns a list of paths, each a list of {move}/{line} points in tile coordinates
// Points are at whole tile numbers (tile corners), not the +0.5 tile centres testWalls and traceWalls use.
// It starts a path from every wall tile, including tiles in the middle of a run, so runs are drawn several times.
// Its only caller is WALLS at the bottom of this file, which is itself unused.
export function generateWalls(map) {
    let m = map
    let walls = []

    for (let x = 0; x < map[0].length; x++) {
        for (let y = 0; y < map.length; y++) {
            let p = [followPath(map, [{"move": [x, y]}], x, y, 1, 0), followPath(map, [{"move": [x, y]}], x, y, 0, 1)]
            for (let i = 0; i < 2; i++) {
                if (p[i].length > 1) {
                    walls.push(p[i])
                }
            }
        }
    }

    return walls
}

// Extends the path along the wall in direction (dx, dy) until the wall ends or branches
// path is modified in place (paths is the same array) and returned.
// NOTE: because of that, `cont == path` below is always true, so every tile of a run pushes a line point as
// the recursion unwinds (from the far end back to the start), not only the last one. Probably part of why
// this builder drew odd lines; left as is since it's unused.
function followPath(map, path, x, y, dx, dy) {
    let paths = path
    if (map?.[y]?.[x] == 0) {
        if (isJoint(map, x, y)) {
           paths.push({"line": [x, y]}) // end line
           
           let p = [followPath(map, [{"move": [x, y]}], x + 1, y, 1, 0), // right
           followPath(map, [{"move": [x, y]}], x, y + 1, 0, 1)]    // down

           for (let i = 0; i < 2; i++) {
               if (p[i].length > 1) {
                   paths.push(...p[i])
               }
           }
        } else {
            let cont = followPath(map, path, x + dx, y + dy, dx, dy)
            if (cont == path) {
                paths.push({"line": [x, y]})
            }
        }
    } else {
        return path
    }
    return paths
}

// A wall tile is a joint if it has wall neighbours both vertically and horizontally (a corner or junction)
function isJoint(map, x, y) {
    return ((map?.[y + 1]?.[x] == 0) || (map?.[y - 1]?.[x] == 0)) 
    && ((map?.[y]?.[x + 1] == 0) || (map?.[y]?.[x - 1] == 0))
}

// Hand-drawn wall outlines for map 1, with rounded corners. The other maps use traceWalls
// (originally Pacman.WALLS in daleharvey/pacman, see old/pacmanSimple.js).
// Each inner list is one path drawn by map.js drawWall():
//   {"move": [x, y]}            lift the pen and move to (x, y)
//   {"line": [x, y]}            straight line to (x, y)
//   {"curve": [cx, cy, x, y]}   quadratic curve to (x, y) bending towards the control point (cx, cy)
// x is the column and y the row, in tile units, so the line through the middle of tile (col 3, row 9) is at
// [3.5, 9.5]. Corners are drawn as a line stopping half a tile short, then a curve through the corner tile's
// centre, e.g. {"line": [3, 9.5]}, {"curve": [3.5, 9.5, 3.5, 9]}. Paths starting or ending at x = 0 or 19
// run into the board edge around the tunnel.
// NOTE: these only match map 1. If map 1's layout in MAP changes, these won't follow.
export const testWalls = [
    
    [{"move": [0, 9.5]}, {"line": [3, 9.5]},
     {"curve": [3.5, 9.5, 3.5, 9]}, {"line": [3.5, 8]},
     {"curve": [3.5, 7.5, 3, 7.5]}, {"line": [1, 7.5]},
     {"curve": [0.5, 7.5, 0.5, 7]}, {"line": [0.5, 1]},
     {"curve": [0.5, 0.5, 1, 0.5]}, {"line": [9, 0.5]},
     {"curve": [9.5, 0.5, 9.5, 1]}, {"line": [9.5, 3.5]}],

    [{"move": [9.5, 1]},
     {"curve": [9.5, 0.5, 10, 0.5]}, {"line": [18, 0.5]},
     {"curve": [18.5, 0.5, 18.5, 1]}, {"line": [18.5, 7]},
     {"curve": [18.5, 7.5, 18, 7.5]}, {"line": [16, 7.5]},
     {"curve": [15.5, 7.5, 15.5, 8]}, {"line": [15.5, 9]},
     {"curve": [15.5, 9.5, 16, 9.5]}, {"line": [19, 9.5]}],

    [{"move": [2.5, 5.5]}, {"line": [3.5, 5.5]}],

    [{"move": [3, 2.5]},
     {"curve": [3.5, 2.5, 3.5, 3]},
     {"curve": [3.5, 3.5, 3, 3.5]},
     {"curve": [2.5, 3.5, 2.5, 3]},
     {"curve": [2.5, 2.5, 3, 2.5]}],

    [{"move": [15.5, 5.5]}, {"line": [16.5, 5.5]}],

    [{"move": [16, 2.5]}, {"curve": [16.5, 2.5, 16.5, 3]},
     {"curve": [16.5, 3.5, 16, 3.5]}, {"curve": [15.5, 3.5, 15.5, 3]},
     {"curve": [15.5, 2.5, 16, 2.5]}],

    [{"move": [6, 2.5]}, {"line": [7, 2.5]}, {"curve": [7.5, 2.5, 7.5, 3]},
     {"curve": [7.5, 3.5, 7, 3.5]}, {"line": [6, 3.5]},
     {"curve": [5.5, 3.5, 5.5, 3]}, {"curve": [5.5, 2.5, 6, 2.5]}],

    [{"move": [12, 2.5]}, {"line": [13, 2.5]}, {"curve": [13.5, 2.5, 13.5, 3]},
     {"curve": [13.5, 3.5, 13, 3.5]}, {"line": [12, 3.5]},
     {"curve": [11.5, 3.5, 11.5, 3]}, {"curve": [11.5, 2.5, 12, 2.5]}],

    [{"move": [7.5, 5.5]}, {"line": [9, 5.5]}, {"curve": [9.5, 5.5, 9.5, 6]},
     {"line": [9.5, 7.5]}],
    [{"move": [9.5, 6]}, {"curve": [9.5, 5.5, 10.5, 5.5]},
     {"line": [11.5, 5.5]}],


    [{"move": [5.5, 5.5]}, {"line": [5.5, 7]}, {"curve": [5.5, 7.5, 6, 7.5]},
     {"line": [7.5, 7.5]}],
    [{"move": [6, 7.5]}, {"curve": [5.5, 7.5, 5.5, 8]}, {"line": [5.5, 9.5]}],

    [{"move": [13.5, 5.5]}, {"line": [13.5, 7]},
     {"curve": [13.5, 7.5, 13, 7.5]}, {"line": [11.5, 7.5]}],
    [{"move": [13, 7.5]}, {"curve": [13.5, 7.5, 13.5, 8]},
     {"line": [13.5, 9.5]}],

    [{"move": [0, 11.5]}, {"line": [3, 11.5]}, {"curve": [3.5, 11.5, 3.5, 12]},
     {"line": [3.5, 13]}, {"curve": [3.5, 13.5, 3, 13.5]}, {"line": [1, 13.5]},
     {"curve": [0.5, 13.5, 0.5, 14]}, {"line": [0.5, 17]},
     {"curve": [0.5, 17.5, 1, 17.5]}, {"line": [1.5, 17.5]}],
    [{"move": [1, 17.5]}, {"curve": [0.5, 17.5, 0.5, 18]}, {"line": [0.5, 21]},
     {"curve": [0.5, 21.5, 1, 21.5]}, {"line": [18, 21.5]},
     {"curve": [18.5, 21.5, 18.5, 21]}, {"line": [18.5, 18]},
     {"curve": [18.5, 17.5, 18, 17.5]}, {"line": [17.5, 17.5]}],
    [{"move": [18, 17.5]}, {"curve": [18.5, 17.5, 18.5, 17]},
     {"line": [18.5, 14]}, {"curve": [18.5, 13.5, 18, 13.5]},
     {"line": [16, 13.5]}, {"curve": [15.5, 13.5, 15.5, 13]},
     {"line": [15.5, 12]}, {"curve": [15.5, 11.5, 16, 11.5]},
     {"line": [19, 11.5]}],

    [{"move": [5.5, 11.5]}, {"line": [5.5, 13.5]}],
    [{"move": [13.5, 11.5]}, {"line": [13.5, 13.5]}],

    [{"move": [2.5, 15.5]}, {"line": [3, 15.5]},
     {"curve": [3.5, 15.5, 3.5, 16]}, {"line": [3.5, 17.5]}],
    [{"move": [16.5, 15.5]}, {"line": [16, 15.5]},
     {"curve": [15.5, 15.5, 15.5, 16]}, {"line": [15.5, 17.5]}],

    [{"move": [5.5, 15.5]}, {"line": [7.5, 15.5]}],
    [{"move": [11.5, 15.5]}, {"line": [13.5, 15.5]}],
    
    [{"move": [2.5, 19.5]}, {"line": [5, 19.5]},
     {"curve": [5.5, 19.5, 5.5, 19]}, {"line": [5.5, 17.5]}],
    [{"move": [5.5, 19]}, {"curve": [5.5, 19.5, 6, 19.5]},
     {"line": [7.5, 19.5]}],

    [{"move": [11.5, 19.5]}, {"line": [13, 19.5]},
     {"curve": [13.5, 19.5, 13.5, 19]}, {"line": [13.5, 17.5]}],
    [{"move": [13.5, 19]}, {"curve": [13.5, 19.5, 14, 19.5]},
     {"line": [16.5, 19.5]}],

    [{"move": [7.5, 13.5]}, {"line": [9, 13.5]},
     {"curve": [9.5, 13.5, 9.5, 14]}, {"line": [9.5, 15.5]}],
    [{"move": [9.5, 14]}, {"curve": [9.5, 13.5, 10, 13.5]},
     {"line": [11.5, 13.5]}],

    [{"move": [7.5, 17.5]}, {"line": [9, 17.5]},
     {"curve": [9.5, 17.5, 9.5, 18]}, {"line": [9.5, 19.5]}],
    [{"move": [9.5, 18]}, {"curve": [9.5, 17.5, 10, 17.5]},
     {"line": [11.5, 17.5]}],

    [{"move": [8.5, 9.5]}, {"line": [8, 9.5]}, {"curve": [7.5, 9.5, 7.5, 10]},
     {"line": [7.5, 11]}, {"curve": [7.5, 11.5, 8, 11.5]},
     {"line": [11, 11.5]}, {"curve": [11.5, 11.5, 11.5, 11]},
     {"line": [11.5, 10]}, {"curve": [11.5, 9.5, 11, 9.5]},
     {"line": [10.5, 9.5]}]
];

// Unused, built when this file loads. map.js reset() picks testWalls or traceWalls itself.
// NOTE: generateWalls is given the whole MAP list (a deep copy of all the maps) rather than one map, so it treats
// the list of maps as a single map whose "rows" are maps; no "tile" equals 0 and it returns [], so WALLS is
// an empty list. The .map() swapping in testWalls for index 1 never runs.
export const WALLS = generateWalls(MAP.clone()).map((w, i) => i == 1 ? testWalls : w)

// Number of steps to take when searching through map from
// PacMan's position for items
// Used by game.js: the depth limit of the walking-distance searches that build the network's inputs
// (traverseToObjects, and the commented-out bfsToObjects call), and the distance at which getInput()'s norm() reaches 0, so things
// further than this many tiles away read as 0 and closer things approach 1
export const MAX_SEARCH_DISTANCE = 10

