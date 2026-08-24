import type { MindMapDocument, MindMapNode, ViewportState } from '../model';
import { MIND_MAP_VISUAL_TOKENS } from '../styles/visualTokens';
import { edgeIsHiddenInsideCollapsedSection } from './geometry';

const vertexSource = `
attribute vec2 a_position;
attribute vec4 a_color;
uniform vec2 u_resolution;
uniform vec3 u_camera;
varying vec4 v_color;
void main() {
  vec2 view = a_position * u_camera.z + u_camera.xy;
  vec2 clip = view / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const fragmentSource = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }
`;

const color = (value: string, alpha = 1) => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return [0.45, 0.45, 0.5, alpha];
  const number = Number.parseInt(match[1], 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, alpha];
};

const pushVertex = (target: number[], x: number, y: number, rgba: number[]) => {
  target.push(x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
};

const shader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const result = gl.createShader(type);
  if (!result) throw new Error('无法创建 WebGL shader。');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'WebGL shader 编译失败。');
  return result;
};

class Renderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly edgeBuffer: WebGLBuffer;
  private readonly nodeBuffer: WebGLBuffer;
  private readonly position: number;
  private readonly color: number;
  private readonly resolution: WebGLUniformLocation;
  private readonly camera: WebGLUniformLocation;
  private edgeVertexCount = 0;
  private nodeVertexCount = 0;
  private nodeSource: Record<string, MindMapNode> | null = null;
  private edgeSource: MindMapDocument['edges'] | null = null;
  private sectionSource: MindMapDocument['sections'] | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('浏览器不支持 WebGL。');
    const program = gl.createProgram();
    const edgeBuffer = gl.createBuffer();
    const nodeBuffer = gl.createBuffer();
    if (!program || !edgeBuffer || !nodeBuffer) throw new Error('无法初始化 WebGL。');
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program 链接失败。');
    const resolution = gl.getUniformLocation(program, 'u_resolution');
    const camera = gl.getUniformLocation(program, 'u_camera');
    if (!resolution || !camera) throw new Error('WebGL uniform 初始化失败。');
    this.gl = gl;
    this.program = program;
    this.edgeBuffer = edgeBuffer;
    this.nodeBuffer = nodeBuffer;
    this.position = gl.getAttribLocation(program, 'a_position');
    this.color = gl.getAttribLocation(program, 'a_color');
    this.resolution = resolution;
    this.camera = camera;
  }

  private rebuild(document: MindMapDocument, nodes: Record<string, MindMapNode>, edgeNodes: Record<string, MindMapNode>) {
    if (this.nodeSource === nodes && this.edgeSource === document.edges && this.sectionSource === document.sections) return;
    const edgeData: number[] = [];
    for (const edge of Object.values(document.edges)) {
      if (edgeIsHiddenInsideCollapsedSection(edge, document)) continue;
      const source = edgeNodes[edge.sourceId];
      const target = edgeNodes[edge.targetId];
      if (!source || !target) continue;
      const rgba = color(edge.style.color, 0.7);
      pushVertex(edgeData, source.x, source.y, rgba);
      pushVertex(edgeData, target.x, target.y, rgba);
    }
    const nodeData: number[] = [];
    for (const node of Object.values(nodes)) {
      const left = node.x - node.width / 2;
      const right = node.x + node.width / 2;
      const top = node.y - node.height / 2;
      const bottom = node.y + node.height / 2;
      const rgba = color(node.style.fill, node.style.fillOpacity);
      for (const [x, y] of [[left, top], [right, top], [left, bottom], [left, bottom], [right, top], [right, bottom]]) {
        pushVertex(nodeData, x, y, rgba);
      }
    }
    const gl = this.gl;
    this.edgeVertexCount = edgeData.length / 6;
    this.nodeVertexCount = nodeData.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edgeData), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeData), gl.STATIC_DRAW);
    this.nodeSource = nodes;
    this.edgeSource = document.edges;
    this.sectionSource = document.sections;
  }

  draw(
    document: MindMapDocument,
    nodes: Record<string, MindMapNode>,
    edgeNodes: Record<string, MindMapNode>,
    camera: ViewportState,
    size: { width: number; height: number },
  ) {
    this.rebuild(document, nodes, edgeNodes);
    const gl = this.gl;
    const ratio = window.devicePixelRatio || 1;
    const canvas = gl.canvas as HTMLCanvasElement;
    const width = Math.max(1, Math.floor(size.width * ratio));
    const height = Math.max(1, Math.floor(size.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = size.width + 'px';
    canvas.style.height = size.height + 'px';
    gl.viewport(0, 0, width, height);
    const background = color(document.settings.background === '#f9f9fb'
      ? MIND_MAP_VISUAL_TOKENS.color.canvas
      : document.settings.background);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.resolution, size.width, size.height);
    gl.uniform3f(this.camera, camera.x, camera.y, camera.scale);
    gl.enableVertexAttribArray(this.position);
    gl.enableVertexAttribArray(this.color);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.color, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(gl.LINES, 0, this.edgeVertexCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuffer);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.color, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(gl.TRIANGLES, 0, this.nodeVertexCount);
  }
}

const renderers = new WeakMap<HTMLCanvasElement, Renderer>();

export function renderMindMapWebGl(
  canvas: HTMLCanvasElement,
  document: MindMapDocument,
  nodes: Record<string, MindMapNode>,
  edgeNodes: Record<string, MindMapNode>,
  camera: ViewportState,
  size: { width: number; height: number },
) {
  try {
    let renderer = renderers.get(canvas);
    if (!renderer) {
      renderer = new Renderer(canvas);
      renderers.set(canvas, renderer);
    }
    renderer.draw(document, nodes, edgeNodes, camera, size);
    return true;
  } catch {
    return false;
  }
}
