/**
 * DIHASILKAN oleh scripts/pin-whisper.mjs — jangan diedit manual.
 * Sumber: github.com/ggml-org/whisper.cpp v1.9.4 (b5130), huggingface.co/ggerganov/whisper.cpp@5359861c73
 */
import type { BinaryPin, ModelPin } from './manifest'

export const WHISPER_RELEASE = {"version":"v1.9.4","build":"b5130","commit":"927cfce34f31707e17f2bff35c349632fb9e2c3a"} as const

export const BINARY_PINS: Record<'cpu' | 'cuda', BinaryPin> = {
  "cpu": {
    "url": "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip",
    "archiveName": "whisper-bin-x64.zip",
    "size": 8573270,
    "sha256": "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
    "files": [
      {
        "archivePath": "Release/ggml-base.dll",
        "name": "ggml-base.dll",
        "size": 689664,
        "sha256": "a5241b52206f61c9dfd6f0f53a8ef19076f9528ead2db1e039a66d7e03817bfc"
      },
      {
        "archivePath": "Release/ggml-cpu-alderlake.dll",
        "name": "ggml-cpu-alderlake.dll",
        "size": 864256,
        "sha256": "5a5b11dcd38e321b13f85c95414940db9eab1132be3da6342f03dfb1d8e51bd5"
      },
      {
        "archivePath": "Release/ggml-cpu-cannonlake.dll",
        "name": "ggml-cpu-cannonlake.dll",
        "size": 908288,
        "sha256": "2c858781450b52eda95c381232cc65c9e19cbf621cc7b254d8c44fdbab77791e"
      },
      {
        "archivePath": "Release/ggml-cpu-cascadelake.dll",
        "name": "ggml-cpu-cascadelake.dll",
        "size": 904704,
        "sha256": "ddf49bb749b34800afcb3d6224544966a05c5d00f1d0b6565bee9f3b010dd53c"
      },
      {
        "archivePath": "Release/ggml-cpu-haswell.dll",
        "name": "ggml-cpu-haswell.dll",
        "size": 866304,
        "sha256": "6b772e094b8976e22b4c043be86a1a8deda4b50511dc803a693b652c51b24944"
      },
      {
        "archivePath": "Release/ggml-cpu-icelake.dll",
        "name": "ggml-cpu-icelake.dll",
        "size": 904704,
        "sha256": "bbd87ea5920edc401054848071ad2ef8c96bbf8007c4e4cd0ea82ba9b9e3bd10"
      },
      {
        "archivePath": "Release/ggml-cpu-sandybridge.dll",
        "name": "ggml-cpu-sandybridge.dll",
        "size": 860672,
        "sha256": "de2ad5f84c7dfa557d515b3678d6452ce0216590268b2ca79cc537fe87cf239d"
      },
      {
        "archivePath": "Release/ggml-cpu-skylakex.dll",
        "name": "ggml-cpu-skylakex.dll",
        "size": 908288,
        "sha256": "9fa3f9d984ca42d568181dd345072299db2978b328800343218c2c7f000b7152"
      },
      {
        "archivePath": "Release/ggml-cpu-sse42.dll",
        "name": "ggml-cpu-sse42.dll",
        "size": 846848,
        "sha256": "740fc769ef433985dfdb24a609a42d5acf188abda52287a4d89b89b567507c19"
      },
      {
        "archivePath": "Release/ggml-cpu-x64.dll",
        "name": "ggml-cpu-x64.dll",
        "size": 850432,
        "sha256": "43ccf32b9b70aa4c47d0a12ac2ed3c241e0045571acdad565ecd9d1f99ffc08b"
      },
      {
        "archivePath": "Release/ggml.dll",
        "name": "ggml.dll",
        "size": 62464,
        "sha256": "c6e88687d6aa0238f2e834a87958f38d2dc96075a6a7bf6fb8b9cd728a0faed2"
      },
      {
        "archivePath": "Release/whisper-server.exe",
        "name": "whisper-server.exe",
        "size": 726016,
        "sha256": "74c13bcb83b944412b971886d37893611fb31846780c3a78db3847b3132306bc"
      },
      {
        "archivePath": "Release/whisper.dll",
        "name": "whisper.dll",
        "size": 1368576,
        "sha256": "b7bb4ba92bd36b8afe0c00059ca6a0f69c6767193bfb5f0761e9ed27b1087803"
      }
    ]
  },
  "cuda": {
    "url": "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip",
    "archiveName": "whisper-cublas-12.4.0-bin-x64.zip",
    "size": 674539285,
    "sha256": "af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7",
    "minDriver": "527.41",
    "files": [
      {
        "archivePath": "Release/cublas64_12.dll",
        "name": "cublas64_12.dll",
        "size": 100033536,
        "sha256": "e40202fe4223c1cd2d2dce7beec59e1ed61c7801bd827309183be9b50e358f4c"
      },
      {
        "archivePath": "Release/cublasLt64_12.dll",
        "name": "cublasLt64_12.dll",
        "size": 473551360,
        "sha256": "2a896460bef60ed57ef32b0875812f355a6984e671d638bb632f5e8c1d7a831f"
      },
      {
        "archivePath": "Release/cudart64_12.dll",
        "name": "cudart64_12.dll",
        "size": 553984,
        "sha256": "d28e42265da7462162a54da6b7a99ea4fa2caf8139d862bb500db875d0b32dfc"
      },
      {
        "archivePath": "Release/ggml-base.dll",
        "name": "ggml-base.dll",
        "size": 672768,
        "sha256": "7fb5900986476a3ff3160b8ec002005d05c4ba4e6aec8c61ba59b254dcac776c"
      },
      {
        "archivePath": "Release/ggml-cpu-alderlake.dll",
        "name": "ggml-cpu-alderlake.dll",
        "size": 857088,
        "sha256": "87f839db47b18cbd05f164f4b36d6c720ab1bedae7674cd9f6b7187e3b68850a"
      },
      {
        "archivePath": "Release/ggml-cpu-cannonlake.dll",
        "name": "ggml-cpu-cannonlake.dll",
        "size": 901632,
        "sha256": "ad48beacb670415421e6d0e38255f9796f803e304de92bbeb3b5de35a2da67cf"
      },
      {
        "archivePath": "Release/ggml-cpu-cascadelake.dll",
        "name": "ggml-cpu-cascadelake.dll",
        "size": 898560,
        "sha256": "55625077ba07db064c916c11bc5240c3bf50a960eb370cb042a7fbaa4c65af95"
      },
      {
        "archivePath": "Release/ggml-cpu-haswell.dll",
        "name": "ggml-cpu-haswell.dll",
        "size": 858112,
        "sha256": "f87122aa07365e922e22906ddad03073745188d0cbfb6941fbb4d7c1df983945"
      },
      {
        "archivePath": "Release/ggml-cpu-icelake.dll",
        "name": "ggml-cpu-icelake.dll",
        "size": 898560,
        "sha256": "a03e5f9bd16f32e382e21297041306d01bf0db1c2268f0391c853ac443c550cd"
      },
      {
        "archivePath": "Release/ggml-cpu-sandybridge.dll",
        "name": "ggml-cpu-sandybridge.dll",
        "size": 832000,
        "sha256": "192f02b5407bdb508c982b31d929f7bd14872003e6d5f1c68f2e6f21fd22b4b0"
      },
      {
        "archivePath": "Release/ggml-cpu-skylakex.dll",
        "name": "ggml-cpu-skylakex.dll",
        "size": 901632,
        "sha256": "b62ef6e0a36868cec1bf93c9c103a3a8ec0f327810f032b02d3f801e6f0d1dbc"
      },
      {
        "archivePath": "Release/ggml-cpu-sse42.dll",
        "name": "ggml-cpu-sse42.dll",
        "size": 819200,
        "sha256": "e47f1d663d8e92f63d10dc64d57c1307e39acd8542bfe7572f7b0094aa4acb70"
      },
      {
        "archivePath": "Release/ggml-cpu-x64.dll",
        "name": "ggml-cpu-x64.dll",
        "size": 820736,
        "sha256": "558dd2ed51f0aa40ffec14bdaf2204d2c0c7b46876307733a8c492b5636b5273"
      },
      {
        "archivePath": "Release/ggml-cuda.dll",
        "name": "ggml-cuda.dll",
        "size": 544947200,
        "sha256": "1bb5e1526824f39cccb2a1fba609798e383615ad7e732b7bbf675a3d9949610f"
      },
      {
        "archivePath": "Release/ggml.dll",
        "name": "ggml.dll",
        "size": 60928,
        "sha256": "5ee657aee335f23cea8bfb7e6aeaf42773d31c38198030e51554dcebbfab79e1"
      },
      {
        "archivePath": "Release/whisper-server.exe",
        "name": "whisper-server.exe",
        "size": 728576,
        "sha256": "4e6905841f62d7f2b793551ff5deb12f673628995b02fae6266b8eceaaade498"
      },
      {
        "archivePath": "Release/whisper.dll",
        "name": "whisper.dll",
        "size": 1311744,
        "sha256": "26e5b494d807e3e94bd4739da8dac579b3d047765d2e5545251d053c5ead1c7b"
      }
    ]
  }
}

export const MODEL_PINS: Record<'small', ModelPin> = {
  "small": {
    "fileName": "ggml-small.bin",
    "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin",
    "size": 487601967,
    "sha256": "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
  }
}
