import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- Tự động tạo danh sách ảnh (top.jpg + 1.jpg đến 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31;
// Sửa đổi: Đưa top.jpg vào đầu mảng
const bodyPhotoPaths = [
  '/photos/top.jpg',
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`)
];

// --- Cấu hình trực quan ---
const CONFIG = {
  colors: {
    emerald: '#004225', // Xanh ngọc lục bảo thuần
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',   // Trắng tinh khôi
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // Đèn màu
    // Bảng màu viền ảnh Polaroid (tông màu vintage ấm áp)
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    // Màu sắc chi tiết trang trí
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,   // Số lượng ảnh Polaroid
    elements: 200,    // Số lượng chi tiết trang trí
    lights: 400       // Số lượng đèn màu
  },
  tree: { height: 22, radius: 9 }, // Kích thước hình dạng cây
  photos: {
    // Thuộc tính top không cần thiết nữa, vì đã được gộp vào body
    body: bodyPhotoPaths
  }
};

// --- Helper: Kiểm tra điểm nằm trong Ngôi sao 5 cánh ở tâm cờ ---
const isInsideStar = (x: number, y: number) => {
  const r = Math.sqrt(x*x + y*y);
  if (r > 3.0) return false;
  if (r < 0.9) return true;

  let angle = Math.atan2(y, x) - Math.PI / 2; // Đỉnh hướng lên trên
  if (angle < -Math.PI) angle += Math.PI * 2;

  const segment = Math.PI * 2 / 5;
  let localAngle = angle % segment;
  if (localAngle < -segment / 2) localAngle += segment;
  if (localAngle > segment / 2) localAngle -= segment;

  const R_out = 3.0;
  const R_in = 1.15;
  const halfSeg = segment / 2;
  const boundary = (R_in * R_out * Math.sin(halfSeg)) / (R_in * Math.sin(Math.abs(localAngle)) + R_out * Math.sin(halfSeg - Math.abs(localAngle)));

  return r <= boundary;
};

// --- Helper: Sinh tọa độ & màu sắc cho Lá Cờ Việt Nam (Cờ đỏ sao vàng) ---
const getVietnamFlagPositionAndColor = () => {
  const x = (Math.random() - 0.5) * 24;
  const y = (Math.random() - 0.5) * 16;
  const z = 0;

  let color = new THREE.Color('#D32F2F'); // Nền đỏ
  if (isInsideStar(x, y)) {
    color = new THREE.Color('#FFD700'); // Ngôi sao vàng
  }

  return { pos: [x, y, z], color };
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uProgress: 0, uThemeProgress: 0, uIsFlag: 0 },
  `uniform float uTime; uniform float uProgress; uniform float uThemeProgress; uniform float uIsFlag;
  attribute vec3 aTargetPosTree; attribute vec3 aTargetPosTheme;
  attribute vec3 aColorTree; attribute vec3 aColorTheme; attribute float aRandom;
  varying vec2 vUv; varying float vMix; varying vec3 vColor;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    
    // Nội suy vị trí đích trên GPU
    vec3 targetPos = mix(aTargetPosTree, aTargetPosTheme, uThemeProgress);
    
    // ĐẶC BIỆT: Hiệu ứng sóng lá cờ uốn lượn phấp phới đón gió
    if (uIsFlag > 0.5) {
      targetPos.z += sin(uTime * 3.0 + targetPos.x * 0.35) * 0.8 * uThemeProgress;
    }
    
    // Nội suy màu sắc hạt trực tiếp trên GPU
    vColor = mix(aColorTree, aColorTheme, uThemeProgress);
    
    vec3 finalPos = mix(position, targetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `varying float vMix; varying vec3 vColor;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(vColor * 0.3, vColor * 1.3, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Helper: Cosmic Orbit Saturn Ring Shape ---
const getCosmicPosition = () => {
  const radius = 7 + Math.random() * 13;
  const theta = Math.random() * Math.PI * 2;
  return [radius * Math.cos(theta), (Math.random() - 0.5) * 1.8, radius * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state, theme, primaryColor, particleType }: { state: 'CHAOS' | 'FORMED'; theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG'; primaryColor: string; particleType: string }) => {
  const materialRef = useRef<any>(null);
  
  const { positions, targetPositionsTree, targetPositionsTheme, randoms, colorsTree, colorsTheme } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3);
    const targetPositionsTree = new Float32Array(count * 3);
    const targetPositionsTheme = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    const colorsTree = new Float32Array(count * 3);
    const colorsTheme = new Float32Array(count * 3);
    
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    
    // Quyết định màu sắc hạt dựa trên loại hạt người dùng chọn
    const getParticleColor = (type: string) => {
      if (type === 'PEACH') return new THREE.Color('#FF6B8B'); // Hồng đào tết
      if (type === 'MAI') return new THREE.Color('#FFD700');   // Vàng mai phú quý
      if (type === 'HEART') return new THREE.Color('#FF3366'); // Đỏ hồng tình yêu
      if (type === 'BUBBLE') return new THREE.Color('#00E5FF'); // Xanh cyan bong bóng
      return new THREE.Color(primaryColor); // Mặc định là màu chủ đạo
    };

    const treeColor = getParticleColor(particleType);
    
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      
      const [tx, ty, tz] = getTreePosition();
      targetPositionsTree[i*3] = tx; targetPositionsTree[i*3+1] = ty; targetPositionsTree[i*3+2] = tz;
      colorsTree[i*3] = treeColor.r; colorsTree[i*3+1] = treeColor.g; colorsTree[i*3+2] = treeColor.b;
      
      let pos = [0, 0, 0];
      let color = new THREE.Color('#000000');
      
      if (theme === 'COSMIC_ORBIT') {
        pos = getCosmicPosition();
        const rand = Math.random();
        if (rand < 0.4) color = new THREE.Color('#0b2027');
        else if (rand < 0.8) color = new THREE.Color(primaryColor); // Đồng bộ màu chủ đạo vào vũ trụ!
        else color = new THREE.Color('#eceff1');
      } else if (theme === 'VIETNAM_FLAG') {
        const result = getVietnamFlagPositionAndColor();
        pos = result.pos;
        color = result.color;
      } else {
        pos = [tx, ty, tz];
        color = treeColor;
      }
      
      targetPositionsTheme[i*3] = pos[0]; targetPositionsTheme[i*3+1] = pos[1]; targetPositionsTheme[i*3+2] = pos[2];
      colorsTheme[i*3] = color.r; colorsTheme[i*3+1] = color.g; colorsTheme[i*3+2] = color.b;
      
      randoms[i] = Math.random();
    }
    return { positions, targetPositionsTree, targetPositionsTheme, randoms, colorsTree, colorsTheme };
  }, [theme, primaryColor, particleType]);

  // Hiệu ứng bay lượn trung gian: Khi đổi theme, ta reset uThemeProgress về 0 trước
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uThemeProgress = 0;
    }
  }, [theme]);

  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
      
      const targetThemeProgress = theme !== 'CHRISTMAS_TREE' ? 1 : 0;
      materialRef.current.uThemeProgress = MathUtils.damp(materialRef.current.uThemeProgress, targetThemeProgress, 1.5, delta);
      
      const isFlagVal = theme === 'VIETNAM_FLAG' ? 1.0 : 0.0;
      materialRef.current.uIsFlag = isFlagVal;
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPosTree" args={[targetPositionsTree, 3]} />
        <bufferAttribute attach="attributes-aTargetPosTheme" args={[targetPositionsTheme, 3]} />
        <bufferAttribute attach="attributes-aColorTree" args={[colorsTree, 3]} />
        <bufferAttribute attach="attributes-aColorTheme" args={[colorsTheme, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
interface PhotoOrnamentsProps {
  state: 'CHAOS' | 'FORMED';
  photoPaths: string[];
  onActiveIndexChange?: (index: number) => void;
  theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG';
}

const PhotoOrnaments = ({ state, photoPaths, onActiveIndexChange, theme }: PhotoOrnamentsProps) => {
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  const closestIndexRef = useRef<number>(-1);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // --- Tải ảnh động an toàn với THREE.TextureLoader (Tránh sập Canvas do Suspense) ---
  const [loadedTextures, setLoadedTextures] = useState<THREE.Texture[]>([]);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let active = true;

    const loadAll = async () => {
      const promises = photoPaths.map((path) => {
        return new Promise<THREE.Texture>((resolve) => {
          loader.load(
            path,
            (texture) => {
              resolve(texture);
            },
            undefined,
            () => {
              // Gặp lỗi tải ảnh -> Dùng ảnh mặc định của cây thông làm dự phòng
              loader.load('/photos/top.jpg', (fallbackTex) => {
                resolve(fallbackTex);
              }, undefined, () => {
                // Phương án cuối cùng: Tạo Texture màu xanh emerald từ Canvas
                const canvas = document.createElement('canvas');
                canvas.width = 128; canvas.height = 128;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.fillStyle = '#004225'; ctx.fillRect(0, 0, 128, 128);
                }
                resolve(new THREE.CanvasTexture(canvas));
              });
            }
          );
        });
      });

      const texs = await Promise.all(promises);
      if (active) {
        setLoadedTextures(texs);
      }
    };

    loadAll();
    return () => { active = false; };
  }, [photoPaths]);

  const data = useMemo(() => {
    if (loadedTextures.length === 0) return [];
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % loadedTextures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [loadedTextures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current || loadedTextures.length === 0 || data.length === 0) return;
    const isFormed = state === 'FORMED';
    const isCosmic = theme === 'COSMIC_ORBIT';
    const isFlag = theme === 'VIETNAM_FLAG';
    const time = stateObj.clock.elapsedTime;

    // 1. Tìm tấm ảnh nằm gần camera nhất ở mặt trước
    let minDistance = Infinity;
    let closestIdx = -1;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      if (!objData) return;

      // Tính toán vị trí đích dựa trên Giao diện
      let themeTargetPos;
      if (isCosmic) {
        // Vũ trụ: Xếp thành 3 quỹ đạo vành đai tròn quay xung quanh lõi Mặt Trời ở [0, 0, 0]
        const ringIdx = i % 3;
        const ringRadius = 10 + ringIdx * 3.5;
        const ringY = -3 + ringIdx * 2.5;

        // Vành đai trong quay nhanh hơn vành ngoài
        const orbitSpeed = 0.12 * (3 - ringIdx);
        const angle = (i / count) * Math.PI * 2 + time * orbitSpeed;

        themeTargetPos = new THREE.Vector3(
          ringRadius * Math.cos(angle),
          ringY,
          ringRadius * Math.sin(angle)
        );
      } else if (isFlag) {
        // Lá cờ Việt Nam: Vòng quỹ đạo xa xoay bảo vệ bao quanh lá cờ
        const angle = (i / count) * Math.PI * 2 + time * 0.07;
        themeTargetPos = new THREE.Vector3(
          16.5 * Math.cos(angle),
          -5.0 + (i % 3) * 5.0,
          16.5 * Math.sin(angle)
        );
      } else {
        // Cây thông: Vị trí xoắn ốc nón
        themeTargetPos = objData.targetPos;
      }

      const target = isFormed ? themeTargetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);

      if (isFormed) {
         if (isCosmic || isFlag) {
           // Vũ trụ, Lá cờ: Hướng ảnh quay theo vành đai
           const lookTarget = new THREE.Vector3(0, group.position.y, 0);
           group.lookAt(lookTarget);
           group.rotateY(Math.PI / 2); // Trưng diện mặt ảnh ra ngoài vòng tròn
         } else {
           // Cây thông: Hướng ra ngoài
           const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
           group.lookAt(targetLookPos);
         }

         const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
         const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
         group.rotation.x += wobbleX;
         group.rotation.z += wobbleZ;

         // Tính toán khoảng cách đến Camera
         const dist = group.position.distanceTo(stateObj.camera.position);
         if (dist < minDistance) {
           minDistance = dist;
           closestIdx = i;
         }
      } else {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
         group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });

    // 2. Cập nhật hiệu ứng Highlight (Viền vàng rực rỡ) cho tấm ảnh gần nhất
    if (isFormed && closestIdx !== -1) {
      groupRef.current.children.forEach((group, i) => {
        const isClosest = i === closestIdx;
        const emissiveIntensity = isClosest ? 3.0 : 1.0;
        const emissiveColor = isClosest ? new THREE.Color(CONFIG.colors.gold) : new THREE.Color(CONFIG.colors.white);
        const borderColor = isClosest ? CONFIG.colors.gold : data[i].borderColor;

        // Ảnh mặt trước
        const frontPhotoMesh = group.children[0]?.children[0] as THREE.Mesh;
        if (frontPhotoMesh && frontPhotoMesh.material) {
          const mat = frontPhotoMesh.material as THREE.MeshStandardMaterial;
          mat.emissive = emissiveColor;
          mat.emissiveIntensity = emissiveIntensity;
        }
        // Khung viền mặt trước
        const frontBorderMesh = group.children[0]?.children[1] as THREE.Mesh;
        if (frontBorderMesh && frontBorderMesh.material) {
          const mat = frontBorderMesh.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color(borderColor);
          mat.emissive = isClosest ? new THREE.Color(CONFIG.colors.gold) : new THREE.Color(0,0,0);
          mat.emissiveIntensity = isClosest ? 0.8 : 0;
        }

        // Ảnh mặt sau
        const backPhotoMesh = group.children[1]?.children[0] as THREE.Mesh;
        if (backPhotoMesh && backPhotoMesh.material) {
          const mat = backPhotoMesh.material as THREE.MeshStandardMaterial;
          mat.emissive = emissiveColor;
          mat.emissiveIntensity = emissiveIntensity;
        }
        // Khung viền mặt sau
        const backBorderMesh = group.children[1]?.children[1] as THREE.Mesh;
        if (backBorderMesh && backBorderMesh.material) {
          const mat = backBorderMesh.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color(borderColor);
          mat.emissive = isClosest ? new THREE.Color(CONFIG.colors.gold) : new THREE.Color(0,0,0);
          mat.emissiveIntensity = isClosest ? 0.8 : 0;
        }
      });

      // Truyền chỉ số ảnh được chọn ra ngoài cho Component cha
      if (closestIdx !== closestIndexRef.current) {
        closestIndexRef.current = closestIdx;
        if (onActiveIndexChange) {
          onActiveIndexChange(closestIdx);
        }
      }
    }
  });

  if (loadedTextures.length === 0 || data.length === 0) return null;

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          {/* Mặt trước */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={loadedTextures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={loadedTextures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          {/* Mặt sau */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={loadedTextures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={loadedTextures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state, theme }: { state: 'CHAOS' | 'FORMED'; theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const isCosmic = theme === 'COSMIC_ORBIT';
    const isFlag = theme === 'VIETNAM_FLAG';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      
      let themeTargetPos;
      if (isCosmic) {
        // Vũ trụ: Xếp thành vành đai thiên thạch rìa ngoài cùng bập bênh lên xuống nhẹ
        const ringIdx = i % 3;
        const radius = 21 + ringIdx * 1.5;
        const speed = 0.08 * (1 + (i % 2) * 0.4);
        const angle = (i / count) * Math.PI * 2 + time * speed;
        themeTargetPos = new THREE.Vector3(
          radius * Math.cos(angle),
          (Math.sin(time * 0.5 + i) * 1.5),
          radius * Math.sin(angle)
        );
      } else if (isFlag) {
        // Lá cờ: Quỹ đạo thiên thạch rìa ngoài cùng bay lơ lửng bồng bềnh
        const radius = 22.0 + (i % 3) * 1.5;
        const speed = 0.04 * (1 + (i % 2) * 0.5);
        const angle = (i / count) * Math.PI * 2 + time * speed;
        themeTargetPos = new THREE.Vector3(
          radius * Math.cos(angle),
          Math.sin(time * 0.3 + i) * 3.0,
          radius * Math.sin(angle)
        );
      } else {
        // Cây thông
        themeTargetPos = objData.targetPos;
      }

      const target = isFormed ? themeTargetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state, theme }: { state: 'CHAOS' | 'FORMED'; theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const isCosmic = theme === 'COSMIC_ORBIT';
    const isFlag = theme === 'VIETNAM_FLAG';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      
      let themeTargetPos;
      if (isCosmic) {
        // Vũ trụ: Xếp thành bão mặt trời nhấp nháy phát sáng sát lõi
        const ringIdx = i % 4;
        const radius = 2.5 + ringIdx * 1.1;
        const speed = 0.35 * (1 + (i % 3) * 0.3);
        const angle = (i / count) * Math.PI * 2 + time * speed;
        themeTargetPos = new THREE.Vector3(
          radius * Math.cos(angle),
          (Math.cos(time * 0.8 + i) * 1.0),
          radius * Math.sin(angle)
        );
      } else if (isFlag) {
        // Lá cờ: Tạo một hào quang ánh sáng bao quanh
        const radius = 13.0 + (i % 3) * 2.0;
        const speed = 0.15 * (1 + (i % 2) * 0.2);
        const angle = (i / count) * Math.PI * 2 + time * speed;
        themeTargetPos = new THREE.Vector3(
          radius * Math.cos(angle),
          Math.sin(time * 0.5 + i) * 4.0,
          radius * Math.sin(angle)
        );
      } else {
        // Cây thông
        themeTargetPos = objData.targetPos;
      }

      const target = isFormed ? themeTargetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { 
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed 
          ? ((isCosmic || isFlag) ? 5 + intensity * 6 : 3 + intensity * 4) 
          : 0; 
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state, theme }: { state: 'CHAOS' | 'FORMED'; theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG' }) => {
  const groupRef = useRef<THREE.Group>(null);
  const currentPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 30, 0));

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4,
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // Chất liệu vàng ròng
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5,
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      
      const isCosmic = theme === 'COSMIC_ORBIT';
      const isFlag = theme === 'VIETNAM_FLAG';
      
      let targetPos;
      if (isCosmic) {
        targetPos = new THREE.Vector3(0, 0, 0); // Bay xuống làm lõi Mặt Trời ở tâm vũ trụ
      } else if (isFlag) {
        targetPos = new THREE.Vector3(0, 11, 0); // Bay lên làm ngôi sao Phương Bắc dẫn đường ở trên cao
      } else {
        targetPos = new THREE.Vector3(0, CONFIG.tree.height / 2 + 1.8, 0); // Đỉnh cây thông
      }
        
      currentPosRef.current.lerp(targetPos, delta * 3.0);
      groupRef.current.position.copy(currentPosRef.current);

      const targetScale = state === 'FORMED' ? (isCosmic ? 2.5 : (isFlag ? 1.5 : 1.0)) : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3.0);
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({
  sceneState,
  rotationSpeed,
  photoPaths,
  onActiveIndexChange,
  theme,
  primaryColor,
  particleType,
  autoRotateSpeed
}: {
  sceneState: 'CHAOS' | 'FORMED';
  rotationSpeed: number;
  photoPaths: string[];
  onActiveIndexChange?: (index: number) => void;
  theme: 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG';
  primaryColor: string;
  particleType: string;
  autoRotateSpeed: number;
}) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED' && autoRotateSpeed > 0} autoRotateSpeed={autoRotateSpeed} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={primaryColor} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} theme={theme} primaryColor={primaryColor} particleType={particleType} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} photoPaths={photoPaths} onActiveIndexChange={onActiveIndexChange} theme={theme} />
           <ChristmasElements state={sceneState} theme={theme} />
           <FairyLights state={sceneState} theme={theme} />
           <TopStar state={sceneState} theme={theme} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={primaryColor} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sử dụng Refs để lưu trữ các hàm callback và state phụ thuộc, tránh re-render gây khởi tạo lại AI nhiều lần
  const onGestureRef = useRef(onGesture);
  const onMoveRef = useRef(onMove);
  const onStatusRef = useRef(onStatus);
  const debugModeRef = useRef(debugMode);

  useEffect(() => { onGestureRef.current = onGesture; }, [onGesture]);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { debugModeRef.current = debugMode; }, [debugMode]);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    let streamRef: MediaStream | null = null;

    const setup = async () => {
      onStatusRef.current("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        onStatusRef.current("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => console.warn("Yêu cầu phát video camera bị gián đoạn an toàn:", e));
            onStatusRef.current("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
            onStatusRef.current("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatusRef.current(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            
            const isDebug = debugModeRef.current;
            if (ctx && isDebug) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !isDebug) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 onGestureRef.current(name);
                 if (isDebug) onStatusRef.current(`DETECTED: ${name}`);
              }
              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                onMoveRef.current(Math.abs(speed) > 0.01 ? speed : 0);
              }
            } else { 
              onMoveRef.current(0); 
              if (isDebug) onStatusRef.current("AI READY: NO HAND"); 
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => {
      cancelAnimationFrame(requestRef);
      if (streamRef) {
        streamRef.getTracks().forEach(track => track.stop());
      }
      if (gestureRecognizer) {
        gestureRecognizer.close();
      }
    };
  }, []); // Cực kỳ quan trọng: Chỉ khởi chạy đúng 1 lần duy nhất để tránh xung đột WebGL!

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- Photo Link Parser (Google Drive & Direct Link) ---
const getDirectOrDrivePhotoLink = (url: string) => {
  if (!url) return '';
  const trimmed = url.trim();
  const fileIdRegex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
  const openIdRegex = /[?&]id=([a-zA-Z0-9_-]+)/;
  
  let match = trimmed.match(fileIdRegex);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  
  match = trimmed.match(openIdRegex);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  
  if (trimmed.startsWith('http') || trimmed.startsWith('//')) {
    return trimmed;
  }
  if (trimmed.length > 20 && !trimmed.includes('/')) {
    return `https://lh3.googleusercontent.com/d/${trimmed}`;
  }
  return trimmed;
};

// Mã hóa an toàn Unicode sang Base64
const encodeBase64 = (str: string) => {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
};

// Giải mã an toàn Base64 sang Unicode
const decodeBase64 = (str: string) => {
  try {
    return decodeURIComponent(atob(str).split('').map((c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  } catch (e) {
    return '';
  }
};

// --- YouTube ID Parser ---
const getYoutubeVideoId = (url: string) => {
  if (!url) return '';
  const trimmed = url.trim();
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = trimmed.match(regExp);
  return (match && match[2].length === 11) ? match[2] : '';
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);

  // --- Quản lý các tùy chỉnh cá nhân hóa của Khầy ---
  const [greetingText, setGreetingText] = useState<string>(() => {
    return localStorage.getItem('album_3d_greeting_text') || 'Chào Mừng Đến Với Album Kỷ Niệm 3D';
  });
  const [primaryColor, setPrimaryColor] = useState<string>(() => {
    return localStorage.getItem('album_3d_primary_color') || '#FFD700'; // Mặc định vàng hoàng kim cực sang
  });
  const [particleType, setParticleType] = useState<string>(() => {
    return localStorage.getItem('album_3d_particle_type') || 'EMERALD'; // Mặc định là hạt xanh ngọc
  });
  const [autoRotateSpeed, setAutoRotateSpeed] = useState<number>(() => {
    const saved = localStorage.getItem('album_3d_auto_rotate_speed');
    return saved ? parseFloat(saved) : 0.5; // Tốc độ xoay mặc định là 0.5
  });

  // --- Quản lý trạng thái Tải trang & Chế độ xem (Loading & Viewer Mode) ---
  const [isViewerMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('album'); // Tự động bật chế độ Viewer khi mở bằng link chia sẻ
  });
  const [isPageLoading, setIsPageLoading] = useState<boolean>(true); // Mặc định hiển thị màn hình Loading nghệ thuật

  // Quản lý Giao diện 3D đang chọn (Lưu vào localStorage)
  const [activeTheme, setActiveTheme] = useState<'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG'>(() => {
    const saved = localStorage.getItem('christmas_tree_active_theme');
    if (saved === 'VIETNAM_MAP') return 'CHRISTMAS_TREE';
    return (saved as any) || 'CHRISTMAS_TREE';
  });

  // Quản lý link ảnh Google Drive từ localStorage
  const [gDriveInput, setGDriveInput] = useState<string>(() => {
    return localStorage.getItem('christmas_tree_gdrive_links') || '';
  });

  const [photoPaths, setPhotoPaths] = useState<string[]>(() => {
    const savedLinks = localStorage.getItem('christmas_tree_gdrive_links');
    if (savedLinks) {
      const lines = savedLinks.split('\n').map(l => l.trim()).filter(Boolean);
      const converted = lines.map(getDirectOrDrivePhotoLink).filter(Boolean);
      if (converted.length > 0) return converted;
    }
    return CONFIG.photos.body;
  });

  // --- Quản lý Nhạc Nền YouTube ---
  const [youtubeUrl, setYoutubeUrl] = useState<string>('https://www.youtube.com/watch?v=5qap5aO4i9A'); // Mặc định bài Piano Lofi thư giãn cực hay
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('https://www.youtube.com/watch?v=5qap5aO4i9A');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // --- Quản lý Toast Thông Báo ---
  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // Quản lý ảnh đang được chọn và phóng to
  const [activePhotoIndex, setActivePhotoIndex] = useState<number>(-1);
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);
  // Quản lý lịch sử chỉ số ảnh đã xem để đảm bảo xoay vòng không trùng lặp
  const [viewedIndices, setViewedIndices] = useState<number[]>([]);

  // Tự động giải mã tham số URL chia sẻ Album khi khởi chạy
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const albumData = params.get('album');
    if (albumData) {
      const decoded = decodeBase64(albumData);
      if (decoded) {
        try {
          const parsed = JSON.parse(decoded);
          if (parsed.photos && Array.isArray(parsed.photos)) {
            setPhotoPaths(parsed.photos);
            const combinedLinks = parsed.photos.join('\n');
            setGDriveInput(combinedLinks);
            localStorage.setItem('christmas_tree_gdrive_links', combinedLinks);
          }
          if (parsed.music) {
            setYoutubeUrl(parsed.music);
            setYoutubeUrlInput(parsed.music);
            localStorage.setItem('album_3d_youtube_url', parsed.music);
          }
          if (parsed.theme) {
            setActiveTheme(parsed.theme);
            localStorage.setItem('christmas_tree_active_theme', parsed.theme);
          }
          // GIẢI MÃ CÁC THAM SỐ CÁ NHÂN HÓA MỚI
          if (parsed.greet !== undefined) {
            setGreetingText(parsed.greet);
            localStorage.setItem('album_3d_greeting_text', parsed.greet);
          }
          if (parsed.color) {
            setPrimaryColor(parsed.color);
            localStorage.setItem('album_3d_primary_color', parsed.color);
          }
          if (parsed.part) {
            setParticleType(parsed.part);
            localStorage.setItem('album_3d_particle_type', parsed.part);
          }
          if (parsed.speed !== undefined) {
            setAutoRotateSpeed(parsed.speed);
            localStorage.setItem('album_3d_auto_rotate_speed', String(parsed.speed));
          }

          setAiStatus("ĐÃ TẢI ALBUM CHIA SẺ!");
          setSceneState("FORMED");
          setIsPlaying(true); // Tự động phát khi người dùng mở thiệp chia sẻ
        } catch (e) {
          console.error("Lỗi phân tích dữ liệu chia sẻ Album:", e);
        }
      }
    } else {
      // Nếu không có link chia sẻ -> Đọc youtubeUrl và cấu hình cũ từ localStorage nếu có
      const savedMusic = localStorage.getItem('album_3d_youtube_url');
      if (savedMusic) {
        setYoutubeUrl(savedMusic);
        setYoutubeUrlInput(savedMusic);
      }
      const savedGreet = localStorage.getItem('album_3d_greeting_text');
      if (savedGreet !== null) setGreetingText(savedGreet);

      const savedColor = localStorage.getItem('album_3d_primary_color');
      if (savedColor) setPrimaryColor(savedColor);

      const savedPart = localStorage.getItem('album_3d_particle_type');
      if (savedPart) setParticleType(savedPart);

      const savedSpeed = localStorage.getItem('album_3d_auto_rotate_speed');
      if (savedSpeed) setAutoRotateSpeed(parseFloat(savedSpeed));
    }
  }, []);

  // --- Tự động ẩn màn hình Loading khi AI camera sẵn sàng hoặc gặp lỗi ---
  useEffect(() => {
    if (aiStatus.startsWith("AI READY") || aiStatus.startsWith("ERROR")) {
      const timer = setTimeout(() => {
        setIsPageLoading(false);
      }, 1200); // 1.2 giây để Khầy trải nghiệm màn hình chờ lướt đi thật mượt mà
      return () => clearTimeout(timer);
    }
  }, [aiStatus]);

  // --- Chống nhiễu và sườn xung kích hoạt cử chỉ ---
  const lastGestureRef = useRef<string>("");
  const lastZoomTimeRef = useRef<number>(0);

  // --- Xử lý sự kiện nhận diện cử chỉ thông minh ---
  const handleGesture = (name: string) => {
    // Chỉ kích hoạt khi có sự chuyển đổi cử chỉ (Edge Triggering) để tránh gọi liên tục ở 60 FPS
    if (name === lastGestureRef.current) return;
    lastGestureRef.current = name;

    if (name === "Open_Palm") {
      // Nếu đang phóng to ảnh -> Đóng ảnh phóng lớn, ngược lại thì rã kim thông
      setZoomedPhotoUrl(null);
      setSceneState("CHAOS");
    } else if (name === "Closed_Fist") {
      setSceneState("FORMED");
    } else if (name === "Victory" || name === "Thumbs_Up") {
      // Kích hoạt Zoom ảnh đang Highlight phía trước
      handleZoomActivePhoto();
    }
  };

  const handleZoomActivePhoto = () => {
    const now = Date.now();
    // Cooldown 1.0 giây để tránh việc tay rung làm nhận diện trùng lặp liên tục
    if (now - lastZoomTimeRef.current < 1000) return;
    lastZoomTimeRef.current = now;

    if (photoPaths.length === 0) return;

    // Bắt đầu bằng chỉ số của ảnh đang được highlight sát màn hình nhất
    let targetIndex = activePhotoIndex >= 0 ? activePhotoIndex : 0;

    // Nếu ảnh này đã được xem trong lượt vòng hiện tại -> Tìm kiếm xoay vòng ảnh tiếp theo chưa xem
    if (viewedIndices.includes(targetIndex)) {
      let foundIndex = -1;
      for (let i = 1; i < photoPaths.length; i++) {
        const nextIndex = (targetIndex + i) % photoPaths.length;
        if (!viewedIndices.includes(nextIndex)) {
          foundIndex = nextIndex;
          break;
        }
      }

      if (foundIndex !== -1) {
        targetIndex = foundIndex;
        setViewedIndices((prev) => [...prev, targetIndex]);
      } else {
        // Nếu tất cả ảnh đã được xem hết ít nhất 1 lần -> Reset lịch sử để xem lại vòng mới
        targetIndex = activePhotoIndex >= 0 ? activePhotoIndex : 0;
        setViewedIndices([targetIndex]);
      }
    } else {
      // Nếu ảnh chưa xem -> Đưa vào lịch sử vừa xem
      setViewedIndices((prev) => [...prev, targetIndex]);
    }

    const targetUrl = photoPaths[targetIndex % photoPaths.length];
    setZoomedPhotoUrl(targetUrl);
  };

  // --- Cập nhật danh sách ảnh từ Link dán ---
  const handleUpdatePhotos = () => {
    localStorage.setItem('christmas_tree_gdrive_links', gDriveInput);
    const lines = gDriveInput.split('\n').map(l => l.trim()).filter(Boolean);
    const converted = lines.map(getDirectOrDrivePhotoLink).filter(Boolean);
    
    setViewedIndices([]); // Reset lịch sử xem khi Khầy cập nhật loạt ảnh mới
    
    if (converted.length > 0) {
      setPhotoPaths(converted);
      setActivePhotoIndex(-1);
      setZoomedPhotoUrl(null);
    } else {
      // Trở lại mặc định nếu ô nhập trống
      setPhotoPaths(CONFIG.photos.body);
    }
    // Lắp ráp cây thông tự động để chiêm ngưỡng
    setSceneState("FORMED");
  };

  // --- Điều khiển nhạc nền YouTube ---
  const handleUpdateMusic = () => {
    const videoId = getYoutubeVideoId(youtubeUrlInput);
    if (videoId) {
      setYoutubeUrl(youtubeUrlInput);
      localStorage.setItem('album_3d_youtube_url', youtubeUrlInput);
      setIsPlaying(true);
      setAiStatus("ĐÃ ĐỔI NHẠC NỀN YOUTUBE!");
    } else if (!youtubeUrlInput.trim()) {
      setYoutubeUrl('');
      localStorage.removeItem('album_3d_youtube_url');
      setIsPlaying(false);
    } else {
      setAiStatus("LỖI: LINK YOUTUBE KHÔNG HỢP LỆ");
    }
  };

  const toggleMusic = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    
    if (iframeRef.current) {
      const iframe = iframeRef.current as HTMLIFrameElement;
      const command = nextState ? 'playVideo' : 'pauseVideo';
      iframe.contentWindow?.postMessage(JSON.stringify({
        event: 'command',
        func: command,
        args: []
      }), '*');
    }
  };

  // --- Tạo liên kết chia sẻ Album & Nhạc ---
  const handleShareAlbum = () => {
    const albumObj = {
      photos: photoPaths,
      music: youtubeUrl,
      theme: activeTheme,
      greet: greetingText,
      color: primaryColor,
      part: particleType,
      speed: autoRotateSpeed
    };
    const jsonStr = JSON.stringify(albumObj);
    const base64Str = encodeBase64(jsonStr);
    const shareUrl = `${window.location.origin}${window.location.pathname}?album=${base64Str}`;
    
    navigator.clipboard.writeText(shareUrl).then(() => {
      setToastMessage("Đã copy liên kết chia sẻ Album & Nhạc cá nhân hóa thành công! Gửi ngay cho người thân thôi Khầy ơi! 🚀");
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
    }).catch((err) => {
      console.error("Lỗi sao chép liên kết:", err);
      setAiStatus("LỖI SAO CHÉP LIÊN KẾT");
    });
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
            <Experience
              sceneState={sceneState}
              rotationSpeed={rotationSpeed}
              photoPaths={photoPaths}
              onActiveIndexChange={setActivePhotoIndex}
              theme={activeTheme}
              primaryColor={primaryColor}
              particleType={particleType}
              autoRotateSpeed={autoRotateSpeed}
            />
        </Canvas>
      </div>
      <GestureController onGesture={handleGesture} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} />

      {/* UI - Giao diện Glassmorphism dán Link Google Drive */}
      {!isViewerMode && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '40px',
          zIndex: 10,
          width: '320px',
          padding: '20px',
          borderRadius: '12px',
          backgroundColor: 'rgba(0, 5, 0, 0.65)',
          border: '1px solid rgba(255, 215, 0, 0.25)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
          fontFamily: 'sans-serif',
          userSelect: 'none'
        }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🖼️ Thêm Ảnh Album 3D
        </h3>
        <p style={{ margin: '0 0 12px 0', fontSize: '10px', color: '#aaa', lineHeight: '1.4' }}>
          Dán mỗi link ảnh một dòng (hỗ trợ cả link Google Drive chia sẻ và link ảnh trực tiếp .png, .jpg...).
        </p>
        <textarea
          value={gDriveInput}
          onChange={(e) => setGDriveInput(e.target.value)}
          placeholder="Dán link ảnh vào đây...&#10;https://abc.com/anh1.png&#10;https://drive.google.com/file/d/.../view"
          style={{
            width: '100%',
            height: '100px',
            backgroundColor: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '11px',
            padding: '8px',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontFamily: 'monospace',
            outline: 'none'
          }}
        />
        <button
          onClick={handleUpdatePhotos}
          style={{
            width: '100%',
            marginTop: '10px',
            padding: '10px',
            backgroundColor: '#FFD700',
            color: '#000',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}
        >
          🔄 Cập Nhật Album Ảnh
        </button>
        <button
          onClick={handleShareAlbum}
          style={{
            width: '100%',
            marginTop: '8px',
            padding: '10px',
            backgroundColor: 'rgba(255, 215, 0, 0.1)',
            color: '#FFD700',
            border: '1px solid rgba(255, 215, 0, 0.4)',
            borderRadius: '6px',
            fontWeight: 'bold',
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}
        >
          🔗 Chia Sẻ Album 3D
        </button>
      </div>
      )}

      {/* UI - Giao diện Glassmorphism Trình phát nhạc nền YouTube */}
      {!isViewerMode && (
        <div style={{
          position: 'absolute',
          top: '375px',
          left: '40px',
          zIndex: 10,
          width: '320px',
          padding: '20px',
          borderRadius: '12px',
          backgroundColor: 'rgba(0, 5, 0, 0.65)',
          border: '1px solid rgba(255, 215, 0, 0.25)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
          fontFamily: 'sans-serif',
          userSelect: 'none'
        }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🎵 Nhạc Nền YouTube Ẩn
        </h3>
        <p style={{ margin: '0 0 12px 0', fontSize: '10px', color: '#aaa', lineHeight: '1.4' }}>
          Dán link nhạc YouTube chạy ngầm (chỉ phát tiếng). Nhạc tự động lặp lại liên tục.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            value={youtubeUrlInput}
            onChange={(e) => setYoutubeUrlInput(e.target.value)}
            placeholder="Link bài hát YouTube..."
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '11px',
              padding: '8px',
              outline: 'none'
            }}
          />
          <button
            onClick={handleUpdateMusic}
            style={{
              padding: '0 12px',
              backgroundColor: '#FFD700',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            Đổi
          </button>
        </div>
        
        {youtubeUrl && getYoutubeVideoId(youtubeUrl) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', padding: '10px', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '6px', border: '1px solid rgba(255,215,0,0.1)' }}>
            <span style={{ fontSize: '11px', color: '#FFD700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
              {isPlaying ? '▶️ Đang phát lofi chạy ngầm' : '⏸️ Đang tạm dừng'}
            </span>
            <button
              onClick={toggleMusic}
              style={{
                padding: '6px 12px',
                backgroundColor: isPlaying ? 'rgba(255,0,0,0.2)' : 'rgba(255,215,0,0.2)',
                border: isPlaying ? '1px solid #FF0000' : '1px solid #FFD700',
                color: isPlaying ? '#FF3333' : '#FFD700',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              {isPlaying ? 'TẠM DỪNG' : 'PHÁT NHẠC'}
            </button>
          </div>
        )}
      </div>
      )}

      {/* UI - Giao diện Glassmorphism Bộ Chọn Giao Diện & Tùy Biến Cá Nhân Hóa (Theme & Customization Selector) */}
      {!isViewerMode && (
        <div style={{
          position: 'absolute',
          top: '580px',
          left: '40px',
          zIndex: 10,
          width: '320px',
          padding: '20px',
          borderRadius: '12px',
          backgroundColor: 'rgba(0, 5, 0, 0.65)',
          border: '1px solid rgba(255, 215, 0, 0.25)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
          fontFamily: 'sans-serif',
          userSelect: 'none'
        }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
          👑 Tùy Biến Cá Nhân Hóa 3D
        </h3>
        <p style={{ margin: '0 0 10px 0', fontSize: '10px', color: '#aaa', lineHeight: '1.4' }}>
          Tự tay thiết kế không gian kỷ niệm 3D nghệ thuật theo phong cách của riêng Khầy!
        </p>

        {/* Lựa chọn theme chính */}
        <h4 style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase' }}>
          🎭 Chọn Giao Diện 3D
        </h4>
        <select
          value={activeTheme}
          onChange={(e) => {
            const nextTheme = e.target.value as 'CHRISTMAS_TREE' | 'COSMIC_ORBIT' | 'VIETNAM_FLAG';
            setActiveTheme(nextTheme);
            localStorage.setItem('christmas_tree_active_theme', nextTheme);
            setSceneState("FORMED");
          }}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(255, 215, 0, 0.4)',
            borderRadius: '6px',
            color: '#FFD700',
            fontSize: '12px',
            fontWeight: 'bold',
            outline: 'none',
            cursor: 'pointer',
            marginBottom: '12px',
            fontFamily: 'sans-serif'
          }}
        >
          <option value="CHRISTMAS_TREE" style={{ backgroundColor: '#000', color: '#fff' }}>🌳 Cây Kỷ Niệm 3D</option>
          <option value="COSMIC_ORBIT" style={{ backgroundColor: '#000', color: '#FFD700' }}>🪐 Vũ Trụ & Quỹ Đạo Ảnh</option>
          <option value="VIETNAM_FLAG" style={{ backgroundColor: '#000', color: '#FF3333' }}>🇻🇳 Lá Cờ Việt Nam 3D</option>
        </select>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 215, 0, 0.15)', margin: '12px 0' }} />

        {/* Nhập lời chúc cá nhân */}
        <h4 style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase' }}>
          ✍️ Lời Chúc Kỷ Niệm
        </h4>
        <input
          type="text"
          value={greetingText}
          onChange={(e) => {
            setGreetingText(e.target.value);
            localStorage.setItem('album_3d_greeting_text', e.target.value);
          }}
          placeholder="Ví dụ: Kỷ Niệm Đẹp Mãi Trong Tim..."
          maxLength={80}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '11px',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: '12px',
            fontFamily: 'sans-serif'
          }}
        />

        {/* Chọn màu sắc chủ đạo */}
        <h4 style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase' }}>
          🎨 Chọn Màu Ánh Sáng
        </h4>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {[
            { name: 'Ngọc Lục Bảo', hex: '#004225', color: '#00FF66' },
            { name: 'Vàng Hoàng Kim', hex: '#FFD700', color: '#FFD700' },
            { name: 'Đỏ Hồng Ruby', hex: '#FF3366', color: '#FF3366' },
            { name: 'Xanh Sapphire', hex: '#1976D2', color: '#3399FF' },
            { name: 'Tím Thạch Anh', hex: '#8E24AA', color: '#E066FF' }
          ].map((item) => (
            <button
              key={item.hex}
              onClick={() => {
                setPrimaryColor(item.hex);
                localStorage.setItem('album_3d_primary_color', item.hex);
              }}
              title={item.name}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: item.hex,
                border: primaryColor === item.hex ? '2px solid #FFF' : '1px solid rgba(255,255,255,0.3)',
                boxShadow: primaryColor === item.hex ? `0 0 8px ${item.color}` : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                padding: 0
              }}
            />
          ))}
        </div>

        {/* Chọn hiệu ứng hạt bay */}
        <h4 style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase' }}>
          🌸 Chọn Hiệu Ứng Hạt
        </h4>
        <select
          value={particleType}
          onChange={(e) => {
            setParticleType(e.target.value);
            localStorage.setItem('album_3d_particle_type', e.target.value);
          }}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '6px',
            color: '#FFD700',
            fontSize: '11px',
            outline: 'none',
            cursor: 'pointer',
            marginBottom: '12px',
            fontFamily: 'sans-serif'
          }}
        >
          <option value="EMERALD" style={{ backgroundColor: '#000', color: '#fff' }}>🍃 Lá Kim Ngọc Lục Bảo</option>
          <option value="PEACH" style={{ backgroundColor: '#000', color: '#FF6B8B' }}>🌸 Hoa Đào Ngày Tết</option>
          <option value="MAI" style={{ backgroundColor: '#000', color: '#FFD700' }}>🌼 Hoa Mai Phú Quý</option>
          <option value="HEART" style={{ backgroundColor: '#000', color: '#FF3366' }}>💖 Trái Tim Tình Yêu</option>
          <option value="BUBBLE" style={{ backgroundColor: '#000', color: '#00E5FF' }}>🫧 Bong Bóng Đại Dương</option>
        </select>

        {/* Điều chỉnh tốc độ xoay */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 4px 0' }}>
          <h4 style={{ margin: 0, fontSize: '11px', color: '#FFD700', letterSpacing: '1px', textTransform: 'uppercase' }}>
            🔄 Tốc Độ Tự Động Xoay
          </h4>
          <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>{autoRotateSpeed.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="0"
          max="3"
          step="0.1"
          value={autoRotateSpeed}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setAutoRotateSpeed(val);
            localStorage.setItem('album_3d_auto_rotate_speed', String(val));
          }}
          style={{
            width: '100%',
            accentColor: '#FFD700',
            cursor: 'pointer'
          }}
        />
      </div>
      )}

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Tác Giả Thiết Kế</p>
          <p style={{ fontSize: '18px', color: '#FFD700', fontWeight: 'bold', margin: 0, letterSpacing: '1px' }}>
            👑 N.T.Đ
          </p>
        </div>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Kho Ảnh Kỷ Niệm</p>
          <p style={{ fontSize: '24px', color: '#FFF', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#777', fontWeight: 'normal' }}>BỨC ẢNH POLAROID</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Hạt Nghệ Thuật</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#777', fontWeight: 'normal' }}>LÁ KIM ĐIỂM XUYẾT</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'ẨN CAMERA' : '📷 HIỆN CAMERA'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Tụ Hội Album' : 'Phân Rã Album'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>

      {/* Lời chúc cá nhân hóa Glassmorphism tỏa sáng gợn sóng */}
      {greetingText && (
        <div style={{
          position: 'absolute',
          top: '55px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          padding: '8px 25px',
          borderRadius: '25px',
          backgroundColor: 'rgba(0, 5, 0, 0.4)',
          border: `1px solid ${primaryColor}40`,
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
          color: primaryColor,
          fontFamily: 'serif',
          fontSize: '18px',
          fontWeight: 'bold',
          letterSpacing: '2px',
          textAlign: 'center',
          textShadow: `0 0 8px ${primaryColor}80`,
          animation: 'pulseGlow 3s infinite ease-in-out',
          pointerEvents: 'none',
          userSelect: 'none',
          maxWidth: '85%'
        }}>
          <style>{`
            @keyframes pulseGlow {
              0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.9; }
              50% { transform: translateX(-50%) scale(1.02); opacity: 1; text-shadow: 0 0 15px ${primaryColor}; }
            }
          `}</style>
          ✨ {greetingText} ✨
        </div>
      )}

      {/* UI - Fullscreen Lightbox Zoom (Giao diện phóng ảnh Glassmorphism) */}
      {zoomedPhotoUrl && (
        <div
          onClick={() => setZoomedPhotoUrl(null)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 1000,
            backgroundColor: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            animation: 'fadeIn 0.3s ease-out',
            cursor: 'zoom-out'
          }}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes popIn {
              from { transform: scale(0.85); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
          
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              padding: '20px 20px 60px 20px',
              backgroundColor: '#FFFAF0',
              borderRadius: '8px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.2)',
              animation: 'popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              maxWidth: '90%',
              maxHeight: '90%'
            }}
          >
            <img
              src={zoomedPhotoUrl}
              alt="Zoomed memory"
              style={{
                width: 'auto',
                height: 'auto',
                maxWidth: '450px',
                maxHeight: '55vh',
                objectFit: 'contain',
                border: '1px solid rgba(0,0,0,0.1)',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.1)'
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/photos/top.jpg';
              }}
            />
            <div style={{ marginTop: '25px', fontFamily: 'serif', fontSize: '18px', color: '#2d2d2d', letterSpacing: '1px', fontWeight: 'bold' }}>
              ✨ Khoảnh Khắc Kỷ Niệm Đẹp ✨
            </div>
            
            <div style={{ position: 'absolute', bottom: '15px', right: '20px', fontSize: '10px', color: '#999', fontFamily: 'sans-serif' }}>
              Cử chỉ ✌️ để xem lớn | Cử chỉ ✋ để đóng
            </div>

            <button
              onClick={() => setZoomedPhotoUrl(null)}
              style={{
                position: 'absolute',
                top: '-15px',
                right: '-15px',
                width: '35px',
                height: '35px',
                borderRadius: '50%',
                backgroundColor: '#FFD700',
                border: '2px solid #fff',
                color: '#000',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                fontSize: '16px',
                boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Thẻ Iframe ẩn để phát nhạc YouTube chạy ngầm */}
      {youtubeUrl && getYoutubeVideoId(youtubeUrl) && (
        <iframe
          ref={iframeRef}
          width="1"
          height="1"
          src={`https://www.youtube.com/embed/${getYoutubeVideoId(youtubeUrl)}?enablejsapi=1&autoplay=${isPlaying ? 1 : 0}&loop=1&playlist=${getYoutubeVideoId(youtubeUrl)}&controls=0`}
          title="YouTube Background Player"
          frameBorder="0"
          allow="autoplay; encrypted-media"
          style={{ position: 'absolute', top: '-100px', left: '-100px', opacity: 0, pointerEvents: 'none' }}
        />
      )}

      {/* Toast thông báo lấp lánh */}
      {showToast && (
        <div style={{
          position: 'absolute',
          top: '20px',
          right: '40px',
          zIndex: 10000,
          padding: '15px 25px',
          borderRadius: '8px',
          backgroundColor: 'rgba(0, 5, 0, 0.85)',
          border: '1px solid #FFD700',
          color: '#FFD700',
          fontSize: '13px',
          fontWeight: 'bold',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
          fontFamily: 'sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          🚀 {toastMessage}
        </div>
      )}

      {/* Nút Viral - Tự Tạo Album 3D cho người nhận thiệp */}
      {isViewerMode && (
        <div style={{ position: 'absolute', top: '20px', right: '40px', zIndex: 100 }}>
          <button
            onClick={() => {
              // Tải lại trang không có tham số album để chuyển sang chế độ thiết kế
              window.location.href = window.location.origin + window.location.pathname;
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: 'rgba(0, 5, 0, 0.75)',
              border: `2px solid ${primaryColor}`,
              color: primaryColor,
              fontWeight: 'bold',
              fontSize: '11px',
              letterSpacing: '2px',
              borderRadius: '30px',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              boxShadow: `0 0 15px ${primaryColor}40`,
              transition: 'all 0.3s ease',
              textTransform: 'uppercase',
              fontFamily: 'sans-serif'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = `0 0 25px ${primaryColor}`;
              e.currentTarget.style.backgroundColor = primaryColor;
              e.currentTarget.style.color = '#000';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = `0 0 15px ${primaryColor}40`;
              e.currentTarget.style.backgroundColor = 'rgba(0, 5, 0, 0.75)';
              e.currentTarget.style.color = primaryColor;
            }}
          >
            ✨ TỰ TẠO ALBUM 3D CỦA BẠN ✨
          </button>
        </div>
      )}

      {/* Premium Art Loading Screen phủ toàn màn hình */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#050a05',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        transition: 'opacity 0.8s ease, visibility 0.8s ease',
        opacity: isPageLoading ? 1 : 0,
        visibility: isPageLoading ? 'visible' : 'hidden',
        pointerEvents: isPageLoading ? 'auto' : 'none',
        fontFamily: 'sans-serif'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          border: '3px solid rgba(255, 215, 0, 0.1)',
          borderTop: `3px solid ${primaryColor}`,
          animation: 'loadingSpin 1s infinite linear',
          boxShadow: `0 0 15px ${primaryColor}40`,
          marginBottom: '30px'
        }} />
        <style>{`
          @keyframes loadingSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <div style={{
          color: primaryColor,
          fontSize: '13px',
          fontWeight: 'bold',
          letterSpacing: '3px',
          textTransform: 'uppercase',
          textAlign: 'center',
          textShadow: `0 0 10px ${primaryColor}80`,
          padding: '0 20px',
          lineHeight: '1.8'
        }}>
          {aiStatus === "INITIALIZING..." && "🎨 ĐANG DỰNG HÌNH KHÔNG GIAN 3D NGHỆ THUẬT..."}
          {aiStatus === "DOWNLOADING AI..." && "🛰️ ĐANG TẢI HỆ THỐNG TRÍ TUỆ NHÂN TẠO AI..."}
          {aiStatus === "REQUESTING CAMERA..." && "📷 ĐANG KẾT NỐI CAMERA WEBCAM..."}
          {aiStatus.startsWith("ERROR") && "⚠️ HỆ THỐNG SẴN SÀNG (ĐÃ BỎ QUA CAMERA)..."}
          {aiStatus.startsWith("AI READY") && "✨ HỆ THỐNG ĐÃ SẴN SÀNG! ĐANG KHỞI CHẠY... ✨"}
          {!["INITIALIZING...", "DOWNLOADING AI...", "REQUESTING CAMERA..."].includes(aiStatus) && !aiStatus.startsWith("ERROR") && !aiStatus.startsWith("AI READY") && `⏳ ${aiStatus}`}
        </div>
      </div>
    </div>
  );
}