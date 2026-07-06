# Pizza Ridge

Pizza Ridge is a browser-based 3D pizza delivery driving game built with
Three.js and Vite. You start outside Pizza HQ, pick a glowing delivery route,
then race through a larger city grid to hit every drop-off before the pizzas go
cold.

## Features

- Big city map with long avenues, cross streets, sidewalks, parks, high-rises,
  street furniture, and collision-aware buildings.
- Timed pizza delivery routes across downtown, west-side apartments, east-side
  offices, and full-city express runs.
- Small HUD minimap showing the city grid, available route starts, the active
  delivery path, completed stops, the next target, and the car heading.
- Arcade car handling with drifting, skids, dust, gears, camera motion, honking,
  and unlockable cars.
- A persistent pizza topper on the player car so every vehicle reads as a
  delivery car.
- Browser save data for completed jobs, best times, car selection, sound, and
  camera-motion settings.

## Controls

- `W` / `ArrowUp`: accelerate
- `S` / `ArrowDown`: brake or reverse
- `A` / `ArrowLeft`: steer left
- `D` / `ArrowRight`: steer right
- `Space`: handbrake drift
- `G`: swap unlocked cars
- `H`: honk
- `R`: restart the current route or respawn in free roam

Gamepads are also supported through the browser gamepad API.

## Play Locally

Install dependencies:

```sh
npm install
```

Start the dev server:

```sh
npm run dev
```

Build for production:

```sh
npm run build
```

Run the runtime self-check:

```sh
npm run check
```

## Project Structure

- `src/main.ts`: scene setup, game loop, HUD, persistence, and top-level wiring.
- `src/town.ts`: procedural city map, roads, buildings, parks, Pizza HQ, and
  collision obstacles.
- `src/missions.ts`: pizza delivery route data.
- `src/mission.ts`: mission state machine and route marker handling.
- `src/car.ts`: arcade car physics, model loading, fallback car, and pizza
  topper.
- `src/cars.ts`: unlockable car roster and handling presets.
