# Rust Ridge

Rust Ridge is a browser-based 3D city driving game built with Three.js and
Vite. You start as a driver-for-hire at Mabel's Garage, pick a glowing job
marker, and work your way up from courier runs to the city GP — earning a
garage of real-world legends along the way.

## Features

- Big city map with long avenues, cross streets, sidewalks, parks, high-rises,
  street furniture, and collision-aware buildings.
- A seven-job career arc: a proving-ground shakedown, courier contracts,
  pink-slip street races, a police escape, a demolition contract, and the
  annual Rust Ridge GP.
- Nine unlockable cars with real names — Toyota Hilux, VW Golf GTI, Ford
  Transit, Ford Mustang GT, Ford Crown Victoria, Mack Granite, Nissan GT-R,
  Lamborghini Countach, McLaren MP4/4 — each with its own body, gearbox,
  engine voice, and handling preset.
- A living city: lane-following traffic that yields at intersections, flares
  brake lights, queues behind you, and honks when you block it; pedestrians
  who stroll the blocks, cross at corners, and dive out of the way.
- Small HUD minimap showing the city grid, job starts, the active objective,
  and the car heading.
- Realistic PBR city (asphalt, concrete, brick, HDRI lighting, bloom/SMAA)
  with clearcoat vehicle paint and a cinematic chase camera.
- Arcade car handling with drifting, skids, dust, gears, weight transfer,
  surface grip, camera motion, and honking.
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
- `R`: restart the current job or respawn in free roam

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
- `src/town.ts`: procedural city map, roads, buildings, parks, the garage, and
  collision obstacles.
- `src/missions.ts`: mission data — the seven-job career arc.
- `src/mission.ts`: mission state machine and marker/ring handling.
- `src/car.ts`: arcade car physics, model loading, and the fallback car body.
- `src/cars.ts`: unlockable car roster and handling presets.
- `src/traffic.ts` / `src/peds.ts`: city traffic and pedestrian simulation.
