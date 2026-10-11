// Small, embedded glTF triangle: real WebGL input, never shipped as a player badge.
export function badgeModelFixture() {
  const positions = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) =>
    positions.writeFloatLE(value, index * 4),
  );
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [
        {
          doubleSided: true,
          pbrMetallicRoughness: { baseColorFactor: [0.1, 0.7, 0.3, 1], metallicFactor: 0 },
        },
      ],
      buffers: [{ byteLength: positions.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-1, -1, 0],
          max: [1, 1, 0],
        },
      ],
    }),
  );
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const result = Buffer.alloc(12 + 8 + padded.length + 8 + positions.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(positions.length, 20 + padded.length);
  result.writeUInt32LE(0x004e4942, 24 + padded.length);
  positions.copy(result, 28 + padded.length);
  return result;
}
