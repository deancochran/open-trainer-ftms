import { encodeFtmsControlRequest } from "@deancochran/ftms";
import { FtmsRangeError } from "./errors.js";
import type { ResistanceControlFormat, SimulationParameters, SpinDownControl } from "./types.js";

export const CONTROL_OPCODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startResume: 0x07,
  stopPause: 0x08,
  setSimulation: 0x11,
  spinDown: 0x13,
  setTargetCadence: 0x14,
} as const;

function assertIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new FtmsRangeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

// Quantization and FtmsRangeError remain Open Trainer policy. The shared codec
// requires resolution-aligned inputs, so pass it the already-validated values
// in its human units rather than changing how callers' targets are rounded.

export function requestControlCommand(): Uint8Array {
  return encodeFtmsControlRequest({ op: "requestControl" });
}

export function resetCommand(): Uint8Array {
  return encodeFtmsControlRequest({ op: "reset" });
}

export function startCommand(): Uint8Array {
  return encodeFtmsControlRequest({ op: "startResume" });
}

export function stopCommand(): Uint8Array {
  return encodeFtmsControlRequest({ op: "stopPause", action: "stop" });
}

export function pauseCommand(): Uint8Array {
  return encodeFtmsControlRequest({ op: "stopPause", action: "pause" });
}

export function targetPowerCommand(watts: number): Uint8Array {
  const rounded = Math.round(watts);
  assertIntegerRange(rounded, -32768, 32767, "Target power");
  return encodeFtmsControlRequest({ op: "setTargetPower", powerWatts: rounded });
}

export function targetResistanceCommand(
  level: number,
  format: ResistanceControlFormat = "sint16",
): Uint8Array {
  const encoded = Math.round(level * 10);
  if (format === "uint8") {
    // Published @deancochran/ftms 0.2.0 only encodes signed16 resistance.
    // Keep this explicit compatibility path; never infer it from device data.
    assertIntegerRange(encoded, 0, 255, "Encoded resistance level");
    return Uint8Array.of(CONTROL_OPCODE.setTargetResistance, encoded);
  }
  assertIntegerRange(encoded, -32768, 32767, "Encoded resistance level");
  return encodeFtmsControlRequest({ op: "setTargetResistance", resistanceLevel: encoded / 10 });
}

export function simulationCommand(parameters: SimulationParameters): Uint8Array {
  const windSpeed = Math.round((parameters.windSpeedMps ?? 0) * 1000);
  const grade = Math.round(parameters.gradePercent * 100);
  const rollingResistance = Math.round((parameters.rollingResistance ?? 0.004) * 10_000);
  const windResistance = Math.round((parameters.windResistanceKgPerM ?? 0.51) * 100);

  assertIntegerRange(windSpeed, -32768, 32767, "Encoded wind speed");
  assertIntegerRange(grade, -32768, 32767, "Encoded grade");
  assertIntegerRange(rollingResistance, 0, 255, "Encoded rolling resistance");
  assertIntegerRange(windResistance, 0, 255, "Encoded wind resistance");

  return encodeFtmsControlRequest({
    op: "setIndoorBikeSimulation",
    windSpeedMps: windSpeed / 1000,
    gradePercent: grade / 100,
    crr: rollingResistance / 10_000,
    cwKgPerM: windResistance / 100,
  });
}

export function targetCadenceCommand(rpm: number): Uint8Array {
  const encoded = rpm * 2;
  assertIntegerRange(encoded, 0, 65535, "Target cadence in half-RPM units");
  return encodeFtmsControlRequest({ op: "setTargetedCadence", cadenceRpm: encoded / 2 });
}

export function spinDownCommand(control: SpinDownControl): Uint8Array {
  if (!["start", "ignore"].includes(control)) {
    throw new FtmsRangeError("Spin-down control must be start or ignore.");
  }
  return encodeFtmsControlRequest({ op: "spinDown", action: control });
}
