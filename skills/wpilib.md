---
name: WPILib Best Practices
version: "2025"
---

# WPILib Best Practices

## Blocking Calls in Robot Loops

**Rule:** Never use blocking calls (Thread.sleep, busy-wait loops, blocking I/O) inside `TimedRobot` periodic methods or `Command.execute()`.

**Why:** WPILib runs on a 20ms loop. Blocking calls cause the scheduler to miss deadlines, trigger motor safety timeouts, and make the robot unresponsive.

**Bad:**
```java
@Override
public void teleopPeriodic() {
    Thread.sleep(100); // NEVER do this
    while (!sensor.isReady()) {} // busy-wait — also wrong
}
```

**Good:** Use state machines, Commands with `isFinished()`, or WPILib's `Timer` class to track elapsed time.

---

## CommandScheduler Usage

**Rule:** Do not call `CommandScheduler.getInstance().run()` manually. It is called automatically by `TimedRobot`.

**Why:** Calling `run()` manually causes commands to execute twice per loop iteration, doubling motor outputs and causing erratic behavior.

**Bad:**
```java
@Override
public void teleopPeriodic() {
    CommandScheduler.getInstance().run(); // already called by TimedRobot
}
```

---

## Subsystem periodic() — Telemetry Only

**Rule:** `Subsystem.periodic()` should only update telemetry (SmartDashboard, NetworkTables, logging). Do not place robot logic in `periodic()`.

**Why:** Logic in `periodic()` runs regardless of what commands are scheduled, bypassing the command-based resource management system.

**Bad:**
```java
@Override
public void periodic() {
    if (joystick.getRawButton(1)) {
        motor.set(0.5); // logic doesn't belong here
    }
}
```

**Good:**
```java
@Override
public void periodic() {
    SmartDashboard.putNumber("Arm/Position", encoder.getPosition());
    SmartDashboard.putBoolean("Arm/AtGoal", atGoal());
}
```

---

## SmartDashboard vs NetworkTables

**Rule:** Use `SmartDashboard` for simple driver-facing values. Use `NetworkTables` directly (or AdvantageKit's `Logger`) for structured, high-frequency robot state that needs logging or replay.

**Warning:** Avoid putting the same key on SmartDashboard from multiple places — the last write wins and causes confusing behavior.

---

## Timer Usage

**Rule:** Use `Timer.getFPGATimestamp()` for timing robot events. Do not use `System.currentTimeMillis()` or `System.nanoTime()`.

**Why:** `System.currentTimeMillis()` is not synchronized with the FPGA clock and drifts relative to the robot control loop. The FPGA timestamp is consistent and matches the DS log timestamps.

**Bad:**
```java
long start = System.currentTimeMillis();
```

**Good:**
```java
double start = Timer.getFPGATimestamp();
```

---

## Motor Safety Timeouts

**Rule:** All motor controllers used in open-loop control must have motor safety enabled with an appropriate timeout (typically 0.1–0.2 seconds).

**Why:** Motor safety automatically stops motors if `set()` is not called within the timeout, preventing runaway robot behavior if the control loop crashes.

**Good:**
```java
motor.setSafetyEnabled(true);
motor.setExpiration(0.1);
```

**Note:** Motors driven by PID controllers or followed from a leader should also have safety enabled on the leader.

---

## Encoder Resets

**Warning:** Be careful with `encoder.reset()` or `encoder.setPosition(0)` calls in `periodic()` or during teleop — these can cause discontinuities in position feedback. Only reset encoders at a known mechanical position (e.g., at a limit switch or on robot enable).

---

## RobotContainer Structure

**Rule:** Subsystems and commands should be instantiated in `RobotContainer`, not in `Robot.java`. `Robot.java` should only create `RobotContainer` and hook into the scheduler.

**Rule:** Default commands (`setDefaultCommand`) should be set in `RobotContainer`, not inside the subsystem constructor, to keep subsystems reusable and testable.
