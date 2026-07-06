// Mission content - pure data. GTA-style jobs for Mabel's Pizza's turf war
// with Crusty's: races, escapes, and demolitions.
export interface Point {
  x: number
  z: number
}

export interface MissionDef {
  id: string
  title: string
  color: string
  brief: string // dispatcher's send-off, shown as you start
  winLine: string
  loseLine: string
  timeLimit: number // seconds
  start: { x: number; z: number; heading: number } // marker position + retry pose
  objective:
    | { type: 'checkpoints'; route: Point[] }
    | { type: 'collect'; items: Point[]; finish?: Point; itemStyle?: 'weed' | 'letter' }
    // race: beat a rival driver through the same rings — route legs must be
    // axis-aligned so the AI's straight lines stay on roads
    | { type: 'race'; route: Point[]; rivalSpeed: number }
    // escape: reach the finish while chasers hunt you on the grid — three
    // contacts and the run is lost
    | { type: 'escape'; finish: Point; chasers: Point[]; chaserSpeed: number }
    // smash: flatten every target before the clock runs out
    | { type: 'smash'; targets: Point[] }
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'street-race',
    title: 'Crosstown Clash',
    color: '#ff5c8a',
    brief: "Crusty's fastest driver wants your delivery zone. Beat him through every ring or lose the west side.",
    winLine: 'Dusted him. The west side stays ours.',
    loseLine: 'He took the line. Run it back and reclaim the turf.',
    timeLimit: 95,
    start: { x: -60, z: 170, heading: 0 },
    objective: {
      type: 'race',
      rivalSpeed: 24,
      route: [
        { x: -60, z: 110 },
        { x: -120, z: 110 },
        { x: -120, z: -10 },
        { x: -240, z: -10 },
        { x: -240, z: -190 },
        { x: -60, z: -190 },
        { x: -60, z: -310 },
      ],
    },
  },
  {
    id: 'recipe-run',
    title: 'The Recipe Run',
    color: '#ffd166',
    brief: "You've got Mabel's secret recipe book and Crusty's crew knows it. Three hits and it's theirs — get it home.",
    winLine: "Recipe's safe. Crusty's crew is eating asphalt.",
    loseLine: 'They shook you down and took the book. Steal it back with a rerun.',
    timeLimit: 80,
    start: { x: 0, z: -310, heading: Math.PI },
    objective: {
      type: 'escape',
      finish: { x: 0, z: 170 },
      chaserSpeed: 23,
      chasers: [
        { x: -120, z: -310 },
        { x: 120, z: -310 },
        { x: 0, z: -250 },
      ],
    },
  },
  {
    id: 'wreck-the-lot',
    title: 'Wreck the Lot',
    color: '#9be564',
    brief: "Crusty's pop-up stand is squatting in our park. Flatten every crate before their permit clears.",
    winLine: "Lot's clear. Parks are for pizza picnics, not Crusty's.",
    loseLine: 'Crates still standing. Go finish the demolition.',
    timeLimit: 45,
    start: { x: 150, z: 50, heading: 0 },
    objective: {
      type: 'smash',
      targets: [
        { x: 138, z: 32 },
        { x: 150, z: 34 },
        { x: 162, z: 30 },
        { x: 136, z: 18 },
        { x: 150, z: 20 },
        { x: 164, z: 16 },
        { x: 140, z: 6 },
        { x: 152, z: 4 },
        { x: 163, z: 6 },
        { x: 150, z: 12 },
      ],
    },
  },
]
