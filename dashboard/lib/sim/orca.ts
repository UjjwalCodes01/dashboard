/**
 * ORCA — Optimal Reciprocal Collision Avoidance.
 *
 * van den Berg, Guy, Lin, Manocha, "Reciprocal n-Body Collision Avoidance" (ISRR 2011).
 * Each neighbour contributes a half-plane of velocities that are safe for the next `timeHorizon`
 * seconds, on the assumption that the neighbour is running the same algorithm and will take half
 * the avoidance effort. Picking the allowed velocity nearest the preferred one is a small linear
 * program, solved here exactly the way the reference RVO2 library does.
 *
 * Why it sits underneath PIBT rather than replacing it:
 *
 *   - PIBT reasons about *cells* and needs agents to agree on who goes where. It only works
 *     between robots that can hear each other.
 *   - ORCA reasons about *positions and velocities* and needs no agreement at all — a robot can
 *     build these half-planes from what its own lidar and cameras see.
 *
 * So when a link dies, an aisle is blocked under a robot, or the fleet partitions, the robots that
 * can still talk keep coordinating through PIBT, and every encounter across that boundary falls
 * through to this filter. That is the layer that keeps the collision count at zero when the
 * network does not.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Half-plane of permitted velocities: those `v` with det(direction, v - point) >= 0. */
export interface OrcaLine {
  point: Vec2;
  direction: Vec2;
}

export interface OrcaNeighbour {
  position: Vec2;
  velocity: Vec2;
  radius: number;
}

export interface OrcaAgent extends OrcaNeighbour {
  maxSpeed: number;
}

const det = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const absSq = (a: Vec2) => a.x * a.x + a.y * a.y;
const abs = (a: Vec2) => Math.sqrt(absSq(a));

/**
 * Build one ORCA half-plane per neighbour.
 *
 * `timeHorizon` is how far ahead to guarantee safety; larger values make robots swerve earlier and
 * more conservatively. `timeStep` only matters for pairs that already overlap, where the constraint
 * becomes "separate within one step" instead of "stay clear for the horizon".
 */
export function orcaLines(
  agent: OrcaAgent,
  neighbours: OrcaNeighbour[],
  timeHorizon: number,
  timeStep: number,
): OrcaLine[] {
  const lines: OrcaLine[] = [];
  const invTimeHorizon = 1 / timeHorizon;

  for (const other of neighbours) {
    const relativePosition = sub(other.position, agent.position);
    const relativeVelocity = sub(agent.velocity, other.velocity);
    const distSq = absSq(relativePosition);
    const combinedRadius = agent.radius + other.radius;
    const combinedRadiusSq = combinedRadius * combinedRadius;

    let direction: Vec2;
    let u: Vec2;

    if (distSq > combinedRadiusSq) {
      // no collision yet: w is the offset from the cut-off circle's centre to the relative velocity
      const w = sub(relativeVelocity, mul(relativePosition, invTimeHorizon));
      const wLengthSq = absSq(w);
      const dotProduct1 = dot(w, relativePosition);

      if (dotProduct1 < 0 && dotProduct1 * dotProduct1 > combinedRadiusSq * wLengthSq) {
        // project on the cut-off circle
        const wLength = Math.sqrt(wLengthSq);
        const unitW = mul(w, 1 / wLength);
        direction = { x: unitW.y, y: -unitW.x };
        u = mul(unitW, combinedRadius * invTimeHorizon - wLength);
      } else {
        // project on one of the cone's legs
        const leg = Math.sqrt(distSq - combinedRadiusSq);
        if (det(relativePosition, w) > 0) {
          direction = mul(
            {
              x: relativePosition.x * leg - relativePosition.y * combinedRadius,
              y: relativePosition.x * combinedRadius + relativePosition.y * leg,
            },
            1 / distSq,
          );
        } else {
          direction = mul(
            {
              x: -(relativePosition.x * leg + relativePosition.y * combinedRadius),
              y: -(-relativePosition.x * combinedRadius + relativePosition.y * leg),
            },
            1 / distSq,
          );
        }
        const dotProduct2 = dot(relativeVelocity, direction);
        u = sub(mul(direction, dotProduct2), relativeVelocity);
      }
    } else {
      // already overlapping: escape within a single step
      const invTimeStep = 1 / timeStep;
      const w = sub(relativeVelocity, mul(relativePosition, invTimeStep));
      const wLength = abs(w);
      const unitW = wLength > 1e-9 ? mul(w, 1 / wLength) : { x: 1, y: 0 };
      direction = { x: unitW.y, y: -unitW.x };
      u = mul(unitW, combinedRadius * invTimeStep - wLength);
    }

    // reciprocal: this agent takes half the correction and trusts the other to take the rest
    lines.push({ point: add(agent.velocity, mul(u, 0.5)), direction });
  }

  return lines;
}

/** Optimise along a single constrained line. Returns false if the line's feasible span is empty. */
function linearProgram1(
  lines: OrcaLine[],
  lineNo: number,
  radius: number,
  optVelocity: Vec2,
  directionOpt: boolean,
  result: Vec2,
): boolean {
  const line = lines[lineNo];
  const dotProduct = dot(line.point, line.direction);
  const discriminant = dotProduct * dotProduct + radius * radius - absSq(line.point);
  if (discriminant < 0) return false; // the max-speed circle does not reach this line

  const sqrtDiscriminant = Math.sqrt(discriminant);
  let tLeft = -dotProduct - sqrtDiscriminant;
  let tRight = -dotProduct + sqrtDiscriminant;

  for (let i = 0; i < lineNo; i++) {
    const denominator = det(line.direction, lines[i].direction);
    const numerator = det(lines[i].direction, sub(line.point, lines[i].point));

    if (Math.abs(denominator) <= 1e-9) {
      // parallel lines
      if (numerator < 0) return false;
      continue;
    }

    const t = numerator / denominator;
    if (denominator >= 0) tRight = Math.min(tRight, t);
    else tLeft = Math.max(tLeft, t);
    if (tLeft > tRight) return false;
  }

  if (directionOpt) {
    // optimise direction rather than distance
    const t = dot(optVelocity, line.direction) > 0 ? tRight : tLeft;
    const v = add(line.point, mul(line.direction, t));
    result.x = v.x;
    result.y = v.y;
  } else {
    let t = dot(line.direction, sub(optVelocity, line.point));
    if (t < tLeft) t = tLeft;
    else if (t > tRight) t = tRight;
    const v = add(line.point, mul(line.direction, t));
    result.x = v.x;
    result.y = v.y;
  }
  return true;
}

/** Returns the index of the first infeasible line, or lines.length when all were satisfied. */
function linearProgram2(
  lines: OrcaLine[],
  radius: number,
  optVelocity: Vec2,
  directionOpt: boolean,
  result: Vec2,
): number {
  if (directionOpt) {
    const v = mul(optVelocity, radius);
    result.x = v.x;
    result.y = v.y;
  } else if (absSq(optVelocity) > radius * radius) {
    const v = mul(optVelocity, radius / abs(optVelocity));
    result.x = v.x;
    result.y = v.y;
  } else {
    result.x = optVelocity.x;
    result.y = optVelocity.y;
  }

  for (let i = 0; i < lines.length; i++) {
    if (det(lines[i].direction, sub(lines[i].point, result)) > 0) {
      // the current result is on the wrong side of line i
      const temp = { x: result.x, y: result.y };
      if (!linearProgram1(lines, i, radius, optVelocity, directionOpt, result)) {
        result.x = temp.x;
        result.y = temp.y;
        return i;
      }
    }
  }
  return lines.length;
}

/**
 * Densely-packed fallback: when the constraints admit no velocity at all, relax them uniformly and
 * find the velocity that minimises the worst violation. Guarantees an answer always exists.
 */
function linearProgram3(
  lines: OrcaLine[],
  numObstLines: number,
  beginLine: number,
  radius: number,
  result: Vec2,
): void {
  let distance = 0;

  for (let i = beginLine; i < lines.length; i++) {
    if (det(lines[i].direction, sub(lines[i].point, result)) <= distance) continue;

    const projLines: OrcaLine[] = lines.slice(0, numObstLines);

    for (let j = numObstLines; j < i; j++) {
      const determinant = det(lines[i].direction, lines[j].direction);
      let point: Vec2;

      if (Math.abs(determinant) <= 1e-9) {
        if (dot(lines[i].direction, lines[j].direction) > 0) continue; // same direction
        point = mul(add(lines[i].point, lines[j].point), 0.5);
      } else {
        const t = det(lines[j].direction, sub(lines[i].point, lines[j].point)) / determinant;
        point = add(lines[i].point, mul(lines[i].direction, t));
      }

      let dir = sub(lines[j].direction, lines[i].direction);
      const len = abs(dir);
      if (len <= 1e-9) continue;
      dir = mul(dir, 1 / len);
      projLines.push({ point, direction: dir });
    }

    const temp = { x: result.x, y: result.y };
    const optDir = { x: -lines[i].direction.y, y: lines[i].direction.x };
    if (linearProgram2(projLines, radius, optDir, true, result) < projLines.length) {
      result.x = temp.x;
      result.y = temp.y;
    }
    distance = det(lines[i].direction, sub(lines[i].point, result));
  }
}

/** The permitted velocity closest to `preferred`. Always returns something usable. */
export function orcaVelocity(agent: OrcaAgent, lines: OrcaLine[], preferred: Vec2): Vec2 {
  const result: Vec2 = { x: 0, y: 0 };
  const lineFail = linearProgram2(lines, agent.maxSpeed, preferred, false, result);
  if (lineFail < lines.length) linearProgram3(lines, 0, lineFail, agent.maxSpeed, result);
  return result;
}

/** True when `v` satisfies every half-plane, within tolerance. Used by the tests. */
export function satisfies(lines: OrcaLine[], v: Vec2, eps = 1e-6): boolean {
  return lines.every((l) => det(l.direction, sub(v, l.point)) >= -eps);
}

/**
 * Fastest speed along a fixed heading that stays inside every half-plane.
 *
 * The robots here are grid-constrained: PIBT has already chosen *which* cell to enter, so the only
 * freedom left is how fast to cross. Projecting the ORCA constraints onto that one axis keeps the
 * grid guarantees intact while still enforcing real continuous-space separation, which is what
 * stops two robots clipping each other's corners mid-cell.
 */
export function safeSpeedAlong(lines: OrcaLine[], dir: Vec2, maxSpeed: number): number {
  const len = abs(dir);
  if (len < 1e-9) return 0;
  const unit = mul(dir, 1 / len);
  let upper = maxSpeed;

  for (const l of lines) {
    // require det(l.direction, t*unit - l.point) >= 0
    const a = det(l.direction, unit);
    const b = det(l.direction, l.point);
    if (Math.abs(a) < 1e-9) {
      if (-b < -1e-9) return 0; // no speed along this heading is permitted
      continue;
    }
    const t = b / a;
    if (a < 0) upper = Math.min(upper, t);
    // a > 0 gives a lower bound, which never caps the speed
  }
  return Math.max(0, Math.min(maxSpeed, upper));
}
