---
name: Command-Based Architecture
version: "2025"
---

# Command-Based Architecture

## isFinished() Must Be Implemented

**Rule:** Every `Command` subclass must implement `isFinished()`. A command that never returns `true` from `isFinished()` will run forever until cancelled.

**Critical:** Commands that hold mechanisms in place (e.g., hold arm at angle) should return `false` intentionally and be explicitly cancelled — document this in a comment.

**Bad:**
```java
public class MoveArmCommand extends Command {
    @Override
    public void execute() {
        arm.setGoal(targetAngle);
    }
    // Missing isFinished() — defaults to false, runs forever
}
```

**Good:**
```java
@Override
public boolean isFinished() {
    return arm.atGoal();
}
```

---

## Subsystem Requirements and Conflicts

**Rule:** Commands that actuate a subsystem must declare it via `addRequirements(subsystem)`. Two commands requiring the same subsystem cannot run simultaneously — the scheduler will interrupt the running command.

**Warning:** Forgetting `addRequirements()` allows two commands to drive the same motor simultaneously, causing undefined behavior and potential hardware damage.

**Rule:** Never require a subsystem in a command that only reads from it (sensors, encoders). Requirements should only be declared when the command writes to hardware.

**Bad:**
```java
public class DriveCommand extends Command {
    public DriveCommand(DriveSubsystem drive) {
        // Missing addRequirements — drive subsystem unprotected
    }
}
```

**Good:**
```java
public DriveCommand(DriveSubsystem drive) {
    this.drive = drive;
    addRequirements(drive);
}
```

---

## InstantCommand vs Full Command Class

**Rule:** Use `InstantCommand` (or the `Commands.runOnce()` factory) for single-execution actions with no `execute()` or `isFinished()` logic. Create a full `Command` subclass when you need `execute()`, `isFinished()`, or `end()`.

**Good — simple toggle:**
```java
new InstantCommand(() -> intake.toggle(), intake)
```

**Good — complex sequence:**
```java
public class ScoreCommand extends Command {
    @Override public void initialize() { ... }
    @Override public void execute() { ... }
    @Override public boolean isFinished() { return scorer.isDone(); }
    @Override public void end(boolean interrupted) { scorer.stop(); }
}
```

---

## Decorator API vs Manual Sequencing

**Rule:** Prefer the command decorator API over manual sequencing in `execute()`.

**Use decorators:**
- `.withTimeout(seconds)` — cancels command after a time limit
- `.andThen(command)` — run commands sequentially
- `.alongWith(command)` — run commands in parallel (all must require different subsystems)
- `.raceWith(command)` — run in parallel, cancel all when first finishes
- `.deadlineWith(command)` — run in parallel, cancel others when this finishes
- `.unless(condition)` — skip if condition is true at schedule time
- `.onlyIf(condition)` — only run if condition is true

**Bad — manual sequencing in execute():**
```java
@Override
public void execute() {
    if (step == 0) { arm.setGoal(angle); step++; }
    else if (step == 1 && arm.atGoal()) { intake.run(); step++; }
}
```

**Good — declarative:**
```java
Commands.sequence(
    arm.goToAngle(angle),
    intake.runIntake()
)
```

---

## end() Must Handle Interruption

**Rule:** The `end(boolean interrupted)` method must safely stop the subsystem whether the command completed normally OR was interrupted. Always stop actuators in `end()`.

**Bad:**
```java
@Override
public void end(boolean interrupted) {
    if (!interrupted) motor.stop(); // interrupted leaves motor running!
}
```

**Good:**
```java
@Override
public void end(boolean interrupted) {
    motor.stop(); // always stop
}
```

---

## Trigger Bindings

**Rule:** Button/trigger bindings should be declared in `RobotContainer.configureBindings()` using the `Trigger` API. Avoid polling buttons in `Command.execute()` or subsystem `periodic()`.

**Good:**
```java
new JoystickButton(joystick, 1).onTrue(new ShootCommand(shooter));
new JoystickButton(joystick, 2).whileTrue(new IntakeCommand(intake));
```

---

## Parallel Command Groups and Requirements

**Warning:** `ParallelCommandGroup` (and `.alongWith()`) will throw an exception at runtime if any two sub-commands require the same subsystem. Audit parallel groups carefully — this is a common source of `IllegalArgumentException` crashes at match start.
