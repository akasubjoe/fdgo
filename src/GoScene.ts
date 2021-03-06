// https://threejsfundamentals.org/threejs/lessons/threejs-load-gltf.html
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader";
import {Vector3} from "three";
import {Scene} from "./scene";
import {gtp} from "./index";
import Gtp, {ParserResult, ResponseType} from "./gtp";

export class GoScene extends Scene
{
    private stone_protos: THREE.Scene[] = [];
    private played_stones:THREE.Scene[] = [];
    private controls: OrbitControls;

    private cursor: THREE.Mesh;
    private cursorGTPCoord: string = '';
    private thinking: boolean = false;
    private legal_gtp_coords!: string;

    private readonly fudge_factor_19 = 0.001;
    private readonly fudge_factor_9 = 0.01;
    private readonly board_size = 9;
    private readonly unit_size = 1/(this.board_size+1);
    private readonly square_size = this.unit_size + this.fudge_factor_9;


    public async load_objects() {
        const texture_loader = new THREE.TextureLoader();
        const unit_size = this.unit_size;
        const shadow_material = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.7, transparent: true});
        const shadow =  new THREE.Mesh(new THREE.CircleBufferGeometry(.5, 32), shadow_material);
        shadow.rotateX(-Math.PI/2);
        shadow.position.set(0, 0.001, -0.1);
        const response = await gtp.command('all_legal black');
        this.legal_gtp_coords = response.text;

        const go_stone_black = await this.load_gltf('go-stone-black');
        let stone = go_stone_black.clone();

        stone.add(shadow.clone());
        stone.position.setY(0.5213725566864014);
        stone.scale.set(unit_size, unit_size, unit_size);
        this.stone_protos.push(stone);

        const go_stone_white = await this.load_gltf('go-stone-white');
        stone = go_stone_white.clone();

        stone.add(shadow.clone());
        stone.position.setY(0.5213725566864014);
        stone.scale.set(unit_size, unit_size, unit_size);
        this.stone_protos.push(stone);

        const floor_geometry = new THREE.PlaneBufferGeometry(10,10);

        const floor_texture = texture_loader.load('assets/tex/masonry-wall-texture.jpg');
        const floor_texture_normal = texture_loader.load('assets/tex/masonry-wall-normal-map.jpg');
        const floor_texture_bump = texture_loader.load('assets/tex/masonry-wall-bump-map.jpg');

        for (const texture of [floor_texture, floor_texture_normal, floor_texture_bump]) {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 4);
        }

        const floor_material = new THREE.MeshStandardMaterial( {bumpMap: floor_texture_bump, map: floor_texture} );
//        const floor_material = new THREE.MeshPhongMaterial( {map: floor_texture} );
        const floor = new THREE.Mesh( floor_geometry, floor_material);
        floor.rotateX(-Math.PI/2);
        floor.receiveShadow = true;
        this.scene.add(floor);

        const goban = await this.load_gltf('goban9x9');
        for (const obj of goban.children) {
            obj.castShadow = true;
            if (obj.name !== 'goban')
                obj.receiveShadow = true; // legs

        }


 //       const goban = await this.load_gltf('goban');

         this.scene.add(goban);


        // compute the box that contains all the stuff
        // from root and below
        const box = new THREE.Box3().setFromObject(goban);

        const boxSize = box.getSize(new THREE.Vector3()).length();
        const boxCenter = box.getCenter(new THREE.Vector3());

        // set the camera to frame the box
        // this.frameArea(boxSize * 2, boxSize, boxCenter, this.camera);
        this.camera.lookAt(boxCenter.x, boxCenter.y, boxCenter.z);
        // update the Trackball controls to handle the new size
        this.controls.maxDistance = boxSize * 10;
        this.controls.target.copy(boxCenter);
        this.controls.update();


    }


    private async load_gltf(object_name: string): Promise<THREE.Scene> {
        return new Promise<THREE.Scene>((resolve, reject) => {
            const gltfLoader = new GLTFLoader();

            gltfLoader.load(`/assets/gltf/${object_name}.gltf`, (gltf) => {
                resolve(gltf.scene);

            });
        });
    }

    public update_board_from_gtp_list_stones(list: string[]) {

        this.scene.remove(...this.played_stones);
        this.played_stones = [];

        for (const color of [0, 1]) {
            const coords = list[color].split(' ');
            for (const coord of coords)
                this.update_board_from_gtp_coord(color, coord, false);
        }
        this.scene.add(...this.played_stones);
    }

    // GTP coordinates are 'A1' (bottom left) to 'T19' (top right) - skipping 'I' in the alphabet
    public update_board_from_gtp_coord(color: number, coord: string, add_to_scene: boolean = true) {
        const square_size = this.square_size;
        const half_size = (this.board_size - 1) / 2;
        let column = coord.charCodeAt(0) - 'A'.charCodeAt(0);
        if (column > 7) --column; // no 'I'
        let row = Number.parseInt(coord.substring(1))-1;
        const stone = this.stone_protos[color].clone();
        // Board is centered at 0,0
        stone.position.setX((column-half_size) * square_size);
        stone.position.setZ((row-half_size ) * square_size);
        this.played_stones.push(stone);
        if (add_to_scene)
            this.scene.add(stone);

    }

    public async update_board_from_gtp() {
        const black_stones = await gtp.command('list_stones black');
        const white_stones = await gtp.command('list_stones white');
        this.update_board_from_gtp_list_stones([black_stones.text, white_stones.text]);
    }

    async playStone(color: number, gtp_coord: string) {
        if (this.thinking)
            return;
        this.thinking = true;
        const color_str = Gtp.colorToGtpColor(color);
        let response: ParserResult = await gtp.command('play ' + color_str + ' ' + gtp_coord);

        if (response.response_type == ResponseType.GOOD) {

            response = await gtp.command('genmove ' + Gtp.colorToGtpColor(1 - color));

            if (response.response_type == ResponseType.GOOD) {
                await this.update_board_from_gtp();
            }

        }
        response = await gtp.command('all_legal black');
        this.legal_gtp_coords = response.text;
        this.thinking = false;
    }

    constructor(canvas : HTMLCanvasElement) {
        super(canvas);
        const scene = this.scene;
        const camera = this.camera;
        const renderer = this.renderer;

        renderer.shadowMap.enabled = true;

 //       const cursor = this.cursor =  new THREE.Mesh(new THREE.CircleBufferGeometry(1/20 * .5, 32), new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true}));
        const cursor_legal_material = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.5, transparent: true});
        const cursor_illegal_material = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true});
        const cursor_thinking_material = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.2, transparent: true});
        const cursor = this.cursor =  new THREE.Mesh(new THREE.CircleBufferGeometry(this.unit_size * .5, 32), cursor_legal_material);

        cursor.rotateX(-Math.PI/2);
        let goban:  THREE.Scene;
        // Change the camera fov to 40 from its default of 70
        camera.fov = 45;
        camera.position.set(0, 1.5, .667);


        this.controls = new OrbitControls(camera, canvas);
        this.controls.target.set(0, 100, 0);
        this.controls.update();

        const this_ =  this;
        canvas.ondblclick = async () => { if (!this.thinking) this.playStone(0, this.cursorGTPCoord)};

        scene.add(cursor);

        {
            const skyColor = 0xE1E1FF;  // light blue
            const groundColor = 0xB97A20;  // brownish orange
            const intensity = 1;
            const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
             scene.add(light);
        }

        {
            const color = 0xFFFFFF;
            const intensity = .7;
            const light = new THREE.DirectionalLight(color, intensity);

            light.position.set(2, 10, 5);
            light.castShadow = true;
            scene.add(light);
            // scene.add(light.target);
            const cameraHelper = new THREE.CameraHelper(light.shadow.camera);
            scene.add(cameraHelper);
        }

        this.updateScene = (scene: THREE.Scene, time: number) => {
            const intersects = this.mouse_intersects;
            const limit_coord = (this.board_size+1)/2;
            for (const intersect of intersects) {
                if (intersect.object.name === 'goban') {
                    const col = Math.round(intersect.point.x / this.square_size);
                    const row = Math.round(intersect.point.z / this.square_size);
                    if (row > -limit_coord && row < limit_coord && col > -limit_coord && col < limit_coord) {
                         const x = col * this.square_size;
                        const z = row * this.square_size;
                        const y = intersect.point.y + .001;
                        this.cursor.position.set(x, y, z);
                        const gtp_coord = this.rowCol2GtpCoord(row, col);
 //                       if (this.cursorGTPCoord !== gtp_coord || this.thinking) {
 //                           console.log(gtp_coord);
                            this.cursorGTPCoord = gtp_coord;
                            if (this.thinking) {
                                cursor.material = cursor_thinking_material;
                            } else {
                                cursor.material = cursor_legal_material;
                                cursor.material = this.legal_gtp_coords.includes(gtp_coord) ? cursor_legal_material : cursor_illegal_material;
                            }
 //                       }
                    }

                    break;
                }

            }
        }

    }

    // -9 <= row <= 9, -9 <= col <= 9
    private rowCol2GtpCoord(row: number, column: number) : string {
        column += (this.board_size-1)/2;
        row += (this.board_size+1)/2;
        return 'ABCDEFGHJKLMNOPQRST'.substr(column,1) + row;

    }
    private frameArea(sizeToFitOnScreen: number, boxSize: number, boxCenter: Vector3, camera: THREE.PerspectiveCamera) {
        const halfSizeToFitOnScreen = sizeToFitOnScreen * 0.5;
        const halfFovY = THREE.MathUtils.degToRad(camera.fov * .5);
        const distance = halfSizeToFitOnScreen / Math.tan(halfFovY);
        // compute a unit vector that points in the direction the camera is now
        // in the xz plane from the center of the box
        const direction = (new THREE.Vector3())
            .subVectors(camera.position, boxCenter)
            .multiply(new THREE.Vector3(1, 0, 1))
            .normalize();

        // move the camera to a position distance units way from the center
        // in whatever direction the camera was from the center already
        camera.position.copy(direction.multiplyScalar(distance).add(boxCenter));

        // pick some near and far values for the frustum that
        // will contain the box.
        camera.near = boxSize / 100;
        camera.far = boxSize * 100;

        camera.updateProjectionMatrix();

        // point the camera to look at the center of the box
        camera.lookAt(boxCenter.x, boxCenter.y, boxCenter.z);
    }

}