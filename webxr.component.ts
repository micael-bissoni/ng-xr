import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  Renderer2,
  ViewEncapsulation,
  Input,
} from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

// Declaração de Tipos para o OIMO.js (física de forma tipada)
declare namespace OIMO {
  export class World {
    constructor(options: WorldOptions);
    step(): void;
  }
  export class RigidBody {
    constructor(options: RigidBodyOptions);
    getPosition(): { x: number; y: number; z: number };
    getQuaternion(): { x: number; y: number; z: number; w: number };
  }
  interface WorldOptions {
    timestep?: number;
    iterations?: number;
    broadphase?: number;
    worldscale?: number;
    random?: boolean;
    info?: boolean;
    gravity?: [number, number, number];
  }
  interface RigidBodyOptions {
    type?: string;
    size?: [number, number, number];
    pos?: [number, number, number];
    move?: boolean;
    world: World;
  }
}

// Interface tipada para elementos dinâmicos da cena
interface SceneElement {
  model: THREE.Object3D;
  body?: OIMO.RigidBody;
  mixer?: THREE.AnimationMixer;
}

@Component({
  selector: 'world3d',
  templateUrl: './WebXR.component.html',
  styleUrls: ['./WebXR.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class WebXRComponent implements OnInit {
  @ViewChild('xrContainer', { static: true })
  xrContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('btnVR', { static: false }) btnVR!: ElementRef<HTMLButtonElement>;

  private width: number = 350;
  private height: number = 400;

  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    75,
    this.width / this.height,
    0.1,
    1000
  );
  private renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({
    antialias: true,
  });

  // sky and floor and mainScene
  private world!: OIMO.World;
  private sky!: THREE.Mesh;
  private skybox!: THREE.CubeTexture;
  private floor!: THREE.Mesh;
  private mainScene: THREE.Group = new THREE.Group();

  // player and controllers
  private player: THREE.Object3D = new THREE.Object3D();
  private controller1!: THREE.XRTargetRaySpace;
  private controller2!: THREE.XRTargetRaySpace;

  // raycaster
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private intersected: THREE.Object3D[] = [];
  private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();

  // clock animate
  private clock: THREE.Clock = new THREE.Clock();
  private elementsOfScene: SceneElement[] = [];

  @Input() elements: any[] = [];

  constructor(
    private element: ElementRef,
    private ngRenderer: Renderer2,
  ) {}

  ngOnInit(): void {
    this.world = new OIMO.World({
      timestep: 1 / 60,
      iterations: 8,
      broadphase: 2, // 1 brute force, 2 sweep and prune, 3 volume tree
      worldscale: 1, // scale full world
      random: true, // randomize sample
      info: false, // calculate statistic or not
      gravity: [0, -9.8, 0],
    });

    // Add mainScene
    this.scene.add(this.mainScene);
    this.addPlayer();
  }

  onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Called once per frame, before render, to give the app a chance to update this.scene
  update(): void {
    this.render();
  }

  render(): void {
    if (this.player.userData['walking']) {
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);

      this.player.position.add(direction.multiplyScalar(0.5));

      console.log('this.player.position:', this.player.position);
      console.log('this.camera.rotation:', this.camera.rotation);
    }

    this.cleanIntersected();
    this.intersectObjects(this.controller1);
    this.intersectObjects(this.controller2);

    this.elementsOfScene.forEach(({ model, body, mixer }) => {
      if (mixer) {
        mixer.update(this.clock.getDelta());
      }
      if (body) {
        this.world.step();

        const pos = body.getPosition();
        const quat = body.getQuaternion();

        model.position.set(pos.x, pos.y, pos.z);
        model.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  addPlayer(): void {
    this.loadModel(
      '../../../assets/images/poker/models/human/human.glb',
      (gltf: GLTF) => {
        try {
          this.player.add(gltf.scene);
          this.player.name = 'player1';
          this.player.add(this.camera);
          this.scene.add(this.player);

          this.camera.position.set(0, 1.6, 0.25);
          this.player.userData['velocity'] = new THREE.Vector3();

          this.renderer.setPixelRatio(window.devicePixelRatio);
          this.renderer.setSize(window.innerWidth, window.innerHeight);

          // Padrões modernos para WebXR e cor no Three.js
          this.renderer.xr.enabled = true;
          this.renderer.outputColorSpace = THREE.SRGBColorSpace;

          this.ngRenderer.appendChild(
            this.xrContainer.nativeElement,
            this.renderer.domElement
          );
          this.ngRenderer.appendChild(
            this.xrContainer.nativeElement,
            VRButton.createButton(this.renderer)
          );

          // Add sky
          this.addSky();

          // Add floor
          this.addFloor();

          // Add light
          this.addLight();

          // Add scene
          this.initScene();

          window.addEventListener('resize', () => {
            this.onWindowResize();
          });

          this.onWindowResize();

          this.renderer.setAnimationLoop(() => {
            this.update();
          });
        } catch (error) {
          console.error('Error adding player setup:', error);
        }
      }
    );
  }

  addSky(): void {
    const skyGeometry = new THREE.SphereGeometry(500);
    const skyMaterial = new THREE.MeshNormalMaterial({
      side: THREE.BackSide,
    });
    this.sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(this.sky);
  }

  addFloor(): void {
    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);

    loader.setPath('../../../assets/images/default/textures/patterns/');
    loader.load('checker.png', (texture: THREE.Texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(50, 50);

      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0xffffff,
        shininess: 20,
        flatShading: true,
        map: texture,
      });

      const geometry = new THREE.PlaneGeometry(1000, 1000);

      this.floor = new THREE.Mesh(geometry, material);
      this.floor.rotation.x = -Math.PI / 2;

      // physics
      const ground = new OIMO.RigidBody({
        size: [1000, 40, 1000],
        pos: [0, 0, 0],
        move: false,
        world: this.world,
      });

      this.scene.add(this.floor);
    });
  }

  addSkybox(): void {
    const path = '../../../assets/images/poker/scenary/casino1/';
    const format = '.jpg';
    const loader = new THREE.CubeTextureLoader();
    loader.setCrossOrigin('anonymous');
    this.skybox = loader.load([
      path + '_rt' + format,
      path + '_lf' + format,
      path + '_up' + format,
      path + '_dn' + format,
      path + '_bk' + format,
      path + '_ft' + format,
    ]);

    this.scene.background = this.skybox;
  }

  addLight(): void {
    this.scene.add(new THREE.HemisphereLight(0x808080, 0x606060));

    const light = new THREE.DirectionalLight(0xffffff);
    light.position.set(0, 6, 0);
    light.castShadow = true;
    light.shadow.camera.top = 2;
    light.shadow.camera.bottom = -2;
    light.shadow.camera.right = 2;
    light.shadow.camera.left = -2;
    light.shadow.mapSize.set(4096, 4096);
    this.scene.add(light);
  }

  addControllers(): void {
    this.controller1 = this.renderer.xr.getController(0);
    this.controller1.addEventListener('selectstart', (evt: any) =>
      this.onSelectStart(evt)
    );
    this.controller1.addEventListener('selectend', (evt: any) =>
      this.onSelectEnd(evt)
    );
    this.player.add(this.controller1);

    this.controller2 = this.renderer.xr.getController(1);
    this.controller2.addEventListener('selectstart', (evt: any) =>
      this.onSelectStart(evt)
    );
    this.controller2.addEventListener('selectend', (evt: any) =>
      this.onSelectEnd(evt)
    );
    this.player.add(this.controller2);

    // Helpers modernos usando setAttribute em vez do legado addAttribute
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3)
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 0, 0, 0], 3)
    );

    const line = new THREE.Line(geometry);
    line.name = 'line';
    line.scale.z = 5;

    this.controller1.add(line.clone());
    this.controller2.add(line.clone());
  }

  onSelectStart(event: any): void {
    const controller = event.target as THREE.XRTargetRaySpace;
    const intersections = this.getIntersections(controller);

    if (intersections.length > 0) {
      const intersection = intersections[0];

      // No Three.js moderno, getInverse() foi substituído por copy().invert()
      this.tempMatrix.copy(controller.matrixWorld).invert();

      const object = intersection.object;
      object.matrix.premultiply(this.tempMatrix);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      controller.add(object);

      controller.userData['selected'] = object;
    } else {
      this.player.userData['walking'] = true;
    }
  }

  onSelectEnd(event: any): void {
    const controller = event.target as THREE.XRTargetRaySpace;

    if (controller.userData['selected'] !== undefined) {
      const object = controller.userData['selected'] as THREE.Object3D;
      object.matrix.premultiply(controller.matrixWorld);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      this.mainScene.add(object);

      controller.userData['selected'] = undefined;
    }
    this.player.userData['walking'] = false;
  }

  getIntersections(controller: THREE.XRTargetRaySpace): THREE.Intersection[] {
    this.tempMatrix.identity().extractRotation(controller.matrixWorld);

    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

    return this.raycaster.intersectObjects(this.mainScene.children, true);
  }

  intersectObjects(controller: THREE.XRTargetRaySpace): void {
    if (!controller) return;
    // Do not highlight when already selected
    if (controller.userData['selected'] !== undefined) return;

    const line = controller.getObjectByName('line') as THREE.Line;
    if (!line) return;

    const intersections = this.getIntersections(controller);

    if (intersections.length > 0) {
      const intersection = intersections[0];
      const object = intersection.object;
      this.intersected.push(object);

      line.scale.z = intersection.distance;
    } else {
      line.scale.z = 5;
    }
  }

  cleanIntersected(): void {
    while (this.intersected.length > 0) {
      const object = this.intersected.pop();
    }
  }

  initScene(): void {
    this.addCube();
  }

  addCube(): void {
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshNormalMaterial();
    const model = new THREE.Mesh(geometry, material);
    model.position.set(2, 1, -1.5);
    model.rotation.y = Math.PI / 4;

    // physics
    const body = new OIMO.RigidBody({
      type: 'box',
      size: [0.5, 0.5, 0.5],
      pos: [model.position.x, model.position.y, model.position.z],
      move: true,
      world: this.world,
    });

    this.elementsOfScene.push({ model, body });
    this.mainScene.add(model);
  }

  loadModel(src: string, callback: (gltf: GLTF) => void): void {
    const loader = new GLTFLoader();
    loader.setCrossOrigin('anonymous');

    loader.load(src, (gltf: GLTF) => {
      console.log('gltf:', gltf);
      const model = gltf.scene;
      const mixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations;

      // Play all animations
      clips.forEach((clip) => {
        mixer.clipAction(clip).play();
      });

      // physics
      const body = new OIMO.RigidBody({
        type: 'box',
        size: [0.5, 1.65, 0.75],
        pos: [model.position.x, model.position.y, model.position.z],
        move: true,
        world: this.world,
      });

      this.elementsOfScene.push({ model, body, mixer });
      callback(gltf);
    });
  }
}
