import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Ship } from "../ship/Ship";
import type { Track } from "../track/Track";

/** Time constant (s) for the camera yaw chasing the travel direction. Small =
 * snappy/responsive in corners; just enough to smooth the grip-catch swing. */
const YAW_TAU = 0.09;
/** Baseline DOWNWARD look (rad) on flat track — the camera tips its nose down by
 * this much so the craft sits in the lower third with track visible below it,
 * F-Zero-GX style (~12 deg reproduces the old fixed LOOK_DROP geometry). */
const BASE_PITCH = 0.21;
/** How much of the road's slope the view pitches with (1 = fully course-locked,
 * so the road ahead holds its place in the frame up hills and down drops). */
const PITCH_FACTOR = 1;
/** Time constant (s) for easing the course pitch toward the sampled slope.
 * Longer than yaw so per-frame height sampling can't jitter the horizon. */
const PITCH_TAU = 0.16;
/** How much of the road's surface bank the camera rolls with — a cinematic
 * horizon tilt on banked sections without being nauseating (0 = none, 1 = full). */
const ROLL_FACTOR = 0.7;
/** Time constant (s) for easing the horizon roll toward the surface bank. */
const ROLL_TAU = 0.16;
/** Half-baseline (m) for the ahead/behind slope probe along travel. Larger =
 * smoother slope estimate, less twitch on short bumps. */
const SLOPE_PROBE = 6;
/** Minimum camera height above the track surface beneath it (anti clip-through). */
const GROUND_CLEARANCE = 1.6;
/** Below this horizontal speed we steer the view by heading, not velocity, so a
 * near-stopped craft doesn't make the camera spin on velocity noise. */
const TRAVEL_SPEED_MIN = 4;

/**
 * F-Zero-GX-style chase cam, RIGIDLY MOUNTED TO THE COURSE FRAME: a tight,
 * constant-distance offset behind+above the craft (framing never changes and it
 * reacts instantly — no speed lag), with its whole basis aligned to the course
 * everywhere. It YAWS with the direction of travel (a sideways drift slides the
 * craft across the frame), PITCHES with the road slope (the road ahead stays
 * framed up hills and down drops) and ROLLS with the bank (cinematic horizon
 * tilt). The view and the rig offset are ONE clean rigid rotation built from an
 * orthonormal course basis — never a shear/skew. Held above the track so it
 * can't sink into hills. Speed is sold by FOV + the grid/streaks, never by
 * moving the camera.
 */
export class ChaseCamera {
  readonly camera: UniversalCamera;

  private readonly distance = 7;
  private readonly height = 3.5;
  private readonly baseFov = 0.9;
  private readonly maxFov = 1.04;

  private camYaw = 0;
  private camPitchUp = -BASE_PITCH; // eased look pitch (rad; + = looking UP)
  private camRoll = 0; // eased horizon tilt (rad; + = right edge up, matches bank)
  private initialized = false;

  // Scratch — reused each frame to stay allocation-light.
  private readonly _quat = new Quaternion();
  private readonly _mat = new Matrix();
  private readonly _fwdH = new Vector3(); // horizontal travel dir
  private readonly _forward = new Vector3(); // course forward (pitched)
  private readonly _up = new Vector3(); // course up (pitched + rolled)
  private readonly _right = new Vector3(); // course right (re-derived)
  private readonly _tmp = new Vector3();
  private readonly _pos = new Vector3();
  private readonly _ahead = new Vector3();
  private readonly _behind = new Vector3();

  constructor(scene: Scene) {
    this.camera = new UniversalCamera("chase", new Vector3(0, 10, -20), scene);
    this.camera.fov = this.baseFov;
    this.camera.minZ = 0.3;
    this.camera.maxZ = 2000;
    this.camera.inputs.clear(); // driven manually
    // Drive the view by quaternion so roll survives (setTarget zeroes rotation.z).
    this.camera.rotationQuaternion = this._quat;
  }

  update(dt: number, ship: Ship, track: Track): void {
    const ratio = ship.speedRatio;
    const speed = ship.velocity.length();

    // --- YAW: orient to the DIRECTION OF TRAVEL (velocity), falling back to the
    // heading when nearly stopped. This is what lets the ship sit sideways in a
    // drift while the view stays pointed where you're going. The rig POSITION
    // rides the same orientation at a constant distance, so there's no lag —
    // only the yaw angle is smoothed. ---
    const targetYaw =
      speed > TRAVEL_SPEED_MIN ? Math.atan2(ship.velocity.x, ship.velocity.z) : ship.yaw;

    // Horizontal travel direction (LH: yaw about +Y -> (sin, 0, cos)).
    const sy = Math.sin(targetYaw);
    const cy = Math.cos(targetYaw);

    // --- COURSE PITCH: sample the road height a short way AHEAD and BEHIND along
    // travel; atan2 of the delta is the slope (+ = uphill). We look UP by the
    // slope and DOWN by the flat baseline: pitchUp = slope - BASE_PITCH. On an
    // UPHILL (slope>0) pitchUp rises, lifting the view UP the climbing road so it
    // stays framed (the bug fix); on a DOWNHILL it dips to follow the road
    // falling away. Eased to kill jitter from discrete height sampling. ---
    this._ahead.set(
      ship.position.x + sy * SLOPE_PROBE,
      ship.position.y,
      ship.position.z + cy * SLOPE_PROBE
    );
    this._behind.set(
      ship.position.x - sy * SLOPE_PROBE,
      ship.position.y,
      ship.position.z - cy * SLOPE_PROBE
    );
    const slope = Math.atan2(
      track.locate(this._ahead).height - track.locate(this._behind).height,
      2 * SLOPE_PROBE
    );
    const targetPitchUp = slope * PITCH_FACTOR - BASE_PITCH;

    // --- BANK ROLL: tilt the horizon with the road bank. surfaceRoll is +'ve to
    // raise the RIGHT edge of the road; we build the camera up so a +'ve roll
    // raises the camera's RIGHT side too (verified), matching the sense of a
    // camera bolted to the banked surface. ---
    const targetRoll = ship.surfaceRoll * ROLL_FACTOR;

    if (!this.initialized) {
      this.camYaw = targetYaw;
      this.camPitchUp = targetPitchUp;
      this.camRoll = targetRoll;
      this.initialized = true;
    } else {
      let dYaw = targetYaw - this.camYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // shortest arc
      this.camYaw += dYaw * (1 - Math.exp(-dt / YAW_TAU));
      this.camPitchUp += (targetPitchUp - this.camPitchUp) * (1 - Math.exp(-dt / PITCH_TAU));
      this.camRoll += (targetRoll - this.camRoll) * (1 - Math.exp(-dt / ROLL_TAU));
    }

    // --- Build the orthonormal COURSE BASIS (right, up, forward) from the eased
    // yaw / pitch / roll. Everything below is a clean rigid rotation: we never
    // scale or shear an axis, and we re-derive the basis with cross products so
    // it stays exactly orthonormal (a valid det=+1 rotation). ---
    const syc = Math.sin(this.camYaw);
    const cyc = Math.cos(this.camYaw);
    const sp = Math.sin(this.camPitchUp);
    const cp = Math.cos(this.camPitchUp);

    // Horizontal travel dir (its right is (cyc,0,-syc) = the LH cross-track right
    // Track.ts itself uses: right = (forward.z, 0, -forward.x)).
    this._fwdH.set(syc, 0, cyc);

    // FORWARD = pitch the horizontal travel dir up toward world-up by pitchUp.
    // sp>0 (uphill / less down-look) lifts forward.y => looks UP the road.
    this._forward.set(this._fwdH.x * cp, sp, this._fwdH.z * cp);

    // UP (pre-roll) = the in-plane perpendicular of forward: -fwdH*sin + up*cos.
    // (Pitch is a rotation about the right axis, so the right axis is unchanged.)
    this._up.set(-this._fwdH.x * sp, cp, -this._fwdH.z * sp);

    // ROLL the up vector about the forward axis. Since forward ⊥ upPre, Rodrigues
    // reduces to up = upPre*cos(roll) + (forward x upPre)*sin(roll). +roll raises
    // the camera's RIGHT side, matching +bank (road's right edge up) — verified.
    const sr = Math.sin(this.camRoll);
    const cr = Math.cos(this.camRoll);
    Vector3.CrossToRef(this._forward, this._up, this._tmp); // forward x upPre
    this._up.set(
      this._up.x * cr + this._tmp.x * sr,
      this._up.y * cr + this._tmp.y * sr,
      this._up.z * cr + this._tmp.z * sr
    );

    // RIGHT = up x forward, re-derived so the basis is exactly orthonormal, then
    // re-derive UP from forward x right so the triple is a proper rotation
    // (det +1: right x up = forward), matching Track's own right/up/forward sense.
    Vector3.CrossToRef(this._up, this._forward, this._right);
    this._right.normalize();
    this._forward.normalize();
    Vector3.CrossToRef(this._forward, this._right, this._up);
    this._up.normalize();

    // Compose the orientation quaternion from the basis. FromXYZAxesToRef lays
    // the axes into a rotation matrix (local +X->right, +Y->up, +Z->forward);
    // FromRotationMatrixToRef extracts the matching quaternion. A FreeCamera
    // looks down its LOCAL +Z, so it ends up looking along `forward`.
    Matrix.FromXYZAxesToRef(this._right, this._up, this._forward, this._mat);
    Quaternion.FromRotationMatrixToRef(this._mat, this._quat);

    // POSITION: place the rig at the FIXED local offset (above + behind) expressed
    // in the SAME basis, so it sits behind (-forward) and above (+up) and
    // pitches/rolls rigidly with the course at a constant distance (no lag).
    //   world = ship + up*height - forward*distance
    this._pos.set(
      ship.position.x + this._up.x * this.height - this._forward.x * this.distance,
      ship.position.y + this._up.y * this.height - this._forward.y * this.distance,
      ship.position.z + this._up.z * this.height - this._forward.z * this.distance
    );

    // Anti-clip guard: never below the surface beneath the camera (so it can't
    // sink through the floor on hills/boost), and never below the ship.
    const groundUnderCam = track.locate(this._pos).height;
    const minY = Math.max(groundUnderCam, ship.position.y) + GROUND_CLEARANCE;
    if (this._pos.y < minY) this._pos.y = minY;
    this.camera.position.copyFrom(this._pos);

    // FOV nudges up with speed for the rush, without shrinking the ship.
    const targetFov = this.baseFov + (this.maxFov - this.baseFov) * Math.min(1, ratio);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 5 * dt);
  }

  snapTo(ship: Ship, track: Track): void {
    this.initialized = false;
    this.update(0.016, ship, track);
  }
}
