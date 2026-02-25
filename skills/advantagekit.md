---
name: AdvantageKit Logging
version: "2025"
---

# AdvantageKit Logging

## IO Interface Pattern

**Rule:** All hardware interactions must go through an IO interface. The real hardware implementation and a simulation implementation must both be present.

**Structure:**
```
SubsystemName/
  SubsystemNameIOHardware.java   — real hardware
  SubsystemNameIOSim.java        — simulation
  SubsystemNameIO.java           — interface + @AutoLog inputs class
  SubsystemName.java             — subsystem, depends only on the interface
```

**Why:** This pattern enables log replay — you can re-run the robot's logic against recorded IO data without hardware, which makes debugging match issues possible from the log file alone.

**Critical:** The subsystem must NOT reference hardware classes directly. All hardware calls must go through the IO interface.

**Bad:**
```java
public class Arm extends SubsystemBase {
    private final CANSparkMax motor = new CANSparkMax(1, MotorType.kBrushless); // direct hardware
}
```

**Good:**
```java
public class Arm extends SubsystemBase {
    private final ArmIO io;
    private final ArmIOInputsAutoLogged inputs = new ArmIOInputsAutoLogged();

    public Arm(ArmIO io) {
        this.io = io;
    }
}
```

---

## Logger.recordOutput() for All State

**Rule:** Log all meaningful subsystem state using `Logger.recordOutput()` in `periodic()`. This includes motor outputs, sensor readings, setpoints, and calculated values.

**Why:** Logged outputs are available in AdvantageScope for post-match analysis and replay debugging.

**Good:**
```java
@Override
public void periodic() {
    io.updateInputs(inputs);
    Logger.processInputs("Arm", inputs);

    Logger.recordOutput("Arm/GoalAngle", goal.getDegrees());
    Logger.recordOutput("Arm/AtGoal", atGoal());
    Logger.recordOutput("Arm/FFOutput", ffOutput);
}
```

**Warning:** Do not log inside `execute()` or other non-periodic methods — log in `periodic()` only to ensure consistent 20ms cadence.

---

## No Direct DriverStation Access in Subsystems

**Rule:** Do not call `DriverStation` methods directly inside subsystems. Use the logged inputs pattern to pass enable/mode state through the IO layer if needed, or access it in `Robot.java` and pass it as constructor parameters.

**Why:** Direct `DriverStation` calls are not captured in the log and break replay — the replayed log won't reflect the original enable state correctly.

**Bad:**
```java
@Override
public void periodic() {
    if (DriverStation.isEnabled()) { // breaks replay
        io.setMotor(output);
    }
}
```

---

## Replay Compatibility — No Side Effects in updateInputs()

**Critical Rule:** `updateInputs()` implementations must ONLY read hardware state into the inputs struct. They must never write to hardware (set motor outputs, change modes, etc.).

**Why:** During log replay, `updateInputs()` is replaced with data from the log file. If it had side effects, replaying would cause real hardware writes or corrupt the replay simulation.

**Bad:**
```java
@Override
public void updateInputs(ArmIOInputs inputs) {
    inputs.positionRad = encoder.getPosition();
    motor.set(output); // SIDE EFFECT — breaks replay!
}
```

**Good:**
```java
@Override
public void updateInputs(ArmIOInputs inputs) {
    inputs.positionRad = encoder.getPosition();
    inputs.velocityRadPerSec = encoder.getVelocity();
    inputs.appliedVolts = motor.getAppliedOutput() * motor.getBusVoltage();
    inputs.currentAmps = motor.getOutputCurrent();
}
```

All writes to hardware should happen in separate IO methods (`setVoltage()`, `setPosition()`, etc.) that the subsystem calls from `periodic()` after processing inputs.

---

## @AutoLog Annotation

**Rule:** Use the `@AutoLog` annotation on the IO inputs inner class to automatically generate the `AutoLogged` variant with built-in logging support. Do not manually call `Logger.processInputs()` on a non-AutoLogged class.

**Good:**
```java
public interface ArmIO {
    @AutoLog
    public static class ArmIOInputs {
        public double positionRad = 0.0;
        public double velocityRadPerSec = 0.0;
        public double appliedVolts = 0.0;
        public double currentAmps = 0.0;
    }

    default void updateInputs(ArmIOInputs inputs) {}
    default void setVoltage(double volts) {}
}
```

Then in the subsystem:
```java
private final ArmIOInputsAutoLogged inputs = new ArmIOInputsAutoLogged();
// ...
Logger.processInputs("Arm", inputs); // uses the AutoLogged generated class
```

---

## Simulation Implementation Required

**Rule:** Every IO interface must have a simulation implementation (`IOSim`) that models the physics using WPILib simulation classes (`DCMotorSim`, `ElevatorSim`, `SingleJointedArmSim`, etc.).

**Why:** Sim implementations enable CI testing and driver practice without real hardware, and ensure the subsystem is testable in isolation.
