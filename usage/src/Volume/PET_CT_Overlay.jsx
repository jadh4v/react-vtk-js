import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkLiteHttpDataAccessHelper from '@kitware/vtk.js/IO/Core/DataAccessHelper/LiteHttpDataAccessHelper';
import vtkResourceLoader from '@kitware/vtk.js/IO/Core/ResourceLoader';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps.js';
import { BlendMode } from '@kitware/vtk.js/Rendering/Core/VolumeMapper/Constants.js';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { unzipSync } from 'fflate';
import { useContext, useEffect, useState } from 'react';
import './PET_CT_Overlay.css';

import {
  Contexts,
  Dataset,
  MultiViewRoot,
  RegisterDataSet,
  ShareDataSetRoot,
  SliceRepresentation,
  UseDataSet,
  View,
  VolumeRepresentation,
} from 'react-vtk-js';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';
import { InterpolationMode } from '@kitware/vtk.js/Imaging/Core/AbstractImageInterpolator/Constants';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';

function Slider(props) {
  const view = useContext(Contexts.ViewContext);
  const onChange = (e) => {
    const value = Number(e.currentTarget.value);
    props.setValue(value);
    props.setPTValue(value);
    setTimeout(view?.renderView, 0);
  };
  return (
    <label
      style={{
        position: 'absolute',
        zIndex: 100,
        left: props.style.width + 10,
        ...props.style,
      }}
    >
      {props.label}
      <input
        type='range'
        orient={props.orient}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={onChange}
        style={{
          zIndex: 100,
          ...props.style,
        }}
      />
    </label>
  );
}

function DropDown(props) {
  const view = useContext(Contexts.ViewContext);
  function onChange(e) {
    const value = e.currentTarget.value;
    props.setValue(value);
    setTimeout(view?.renderView, 0);
  }
  return (
    <form>
      <label
        htmlFor={props.label}
        style={{
          position: 'relative',
          zIndex: 100,
          left: '-50px',
          ...props.style,
        }}
      >
        {props.label}
      </label>
      <select
        id={props.label}
        value={props.value}
        onChange={onChange}
        style={{
          position: 'relative',
          zIndex: 100,
          left: '50px',
          top: '5px',
          ...props.style,
        }}
      >
        {props.options.map((opt) => (
          <option key={opt}>{opt}</option>
        ))}
      </select>
    </form>
  );
}

function haveOverlappingGrids(img1, img2, tolerance = vtkMath.EPSILON) {
  if (!img1 || !img2) {
    return false;
  }
  const sameVec3 = (p1, p2, tolerance) => vtkMath.distance2BetweenPoints(p1, p2) < tolerance*tolerance;
  if (!sameVec3(img1.getOrigin(), img2.getOrigin())) {
    return false;
  }
  if (!sameVec3(img1.getSpacing(), img2.getSpacing())) {
    return false;
  }
  if (!sameVec3(img1.getDimensions(), img2.getDimensions())) {
    return false;
  }
  const dir1 = img1.getDirection();
  const dir2 = img2.getDirection();
  const dirDelta = dir1.reduce((accumulator, currentValue, currentIndex) => accumulator + Math.abs(currentValue - dir2[currentIndex]), 0);
  if (dirDelta > tolerance) {
    return false;
  }
  return true;
}

function resliceAndSetup(ctImageData, ptImageData) {
  loader.hidden = 'hidden';
  fileInput.hidden = 'hidden';
  exampleInput.hidden = 'hidden';
  const overlappingGrids = haveOverlappingGrids(ctImageData, ptImageData, 1e-3);
  if (!overlappingGrids) {
    // Resample the image with background series grid:
    const reslicer = vtkImageReslice.newInstance();
    reslicer.setInputData(ptImageData);
    reslicer.setOutputDimensionality(3);
    reslicer.setOutputExtent(ctImageData.getExtent());
    reslicer.setOutputSpacing(ctImageData.getSpacing());
    reslicer.setOutputDirection(ctImageData.getDirection());
    reslicer.setOutputOrigin(ctImageData.getOrigin());
    reslicer.setTransformInputSampling(false);
    reslicer.setInterpolationMode(InterpolationMode.LINEAR)
    ptImageData = reslicer.getOutputData();
    window.setResliced(true);
  }
  window.ptData = ptImageData;
  window.ctData = ctImageData;
  window.setMaxKSlice(ctImageData.getDimensions()[2] - 1);
  window.setMaxJSlice(ctImageData.getDimensions()[1] - 1);
  const range = ptImageData?.getPointData()?.getScalars()?.getRange();
  window.setPTColorWindow(range[1] - range[0]);
  window.setPTColorLevel((range[1] + range[0]) * 0.5);
  window.setStatusText('');
  return [ctImageData, ptImageData];
}

/**
 *  Loads data from local storage. Function expects a zip file with two subfolders: CT, PT
 */
const loadLocalData = async function (event) {
  event.preventDefault();
  console.log('Loading itk module...');
  window.setStatusText('Loading itk module...');
  if (!window.itk) {
    await vtkResourceLoader.loadScript(
      'https://cdn.jsdelivr.net/npm/itk-wasm@1.0.0-b.8/dist/umd/itk-wasm.js'
    );
  }
  const files = event.target.files;
  if (files.length === 1) {
    const fileReader = new FileReader();
    fileReader.onload = async function onLoad(e) {
      const zipFileDataArray = new Uint8Array(fileReader.result);
      const decompressedFiles = unzipSync(zipFileDataArray);
      const ctDCMFiles = [];
      const ptDCMFiles = [];
      const PTRe = /PT/;
      const CTRe = /CT/;
      Object.keys(decompressedFiles).forEach((relativePath) => {
        if (relativePath.endsWith('.dcm')) {
          if (PTRe.test(relativePath)) {
            ptDCMFiles.push(decompressedFiles[relativePath].buffer);
          } else if (CTRe.test(relativePath)) {
            ctDCMFiles.push(decompressedFiles[relativePath].buffer);
          }
        }
      });

      if (ptDCMFiles.length === 0 || ctDCMFiles.length === 0) {
        const msg = 'Expected two directories in the zip file: "PT" and "CT"';
        console.error(msg);
        window.alert(msg);
        return;
      }

      let ctImageData = null;
      let ptImageData = null;
      if (window.itk) {
        const { image: ctitkImage, webWorkerPool: ctWebWorkers } =
          await window.itk.readImageDICOMArrayBufferSeries(ctDCMFiles);
        ctWebWorkers.terminateWorkers();
        ctImageData = vtkITKHelper.convertItkToVtkImage(ctitkImage);
        const { image: ptitkImage, webWorkerPool: ptWebWorkers } =
          await window.itk.readImageDICOMArrayBufferSeries(ptDCMFiles);
        ptWebWorkers.terminateWorkers();
        ptImageData = vtkITKHelper.convertItkToVtkImage(ptitkImage);
      }
      return resliceAndSetup(ctImageData, ptImageData);
    };

    fileReader.readAsArrayBuffer(files[0]);
  }
};

const loadData = async () => {
  console.log('Loading itk module...');
  window.setStatusText('Loading itk module...');
  if (!window.itk) {
    await vtkResourceLoader.loadScript(
      'https://cdn.jsdelivr.net/npm/itk-wasm@1.0.0-b.8/dist/umd/itk-wasm.js'
    );
  }

  console.log('Fetching/downloading the input file, please wait...');
  window.setStatusText('Loading data, please wait...');
  const zipFileData = await vtkLiteHttpDataAccessHelper.fetchBinary(
    'https://data.kitware.com/api/v1/folder/661ad10a5165b19d36c87220/download'
  );

  console.log('Fetching/downloading input file done!');
  window.setStatusText('Download complete!');

  const zipFileDataArray = new Uint8Array(zipFileData);
  const decompressedFiles = unzipSync(zipFileDataArray);
  const ctDCMFiles = [];
  const ptDCMFiles = [];
  const PTRe = /PET AC/;
  const CTRe = /CT IMAGES/;
  Object.keys(decompressedFiles).forEach((relativePath) => {
    if (relativePath.endsWith('.dcm')) {
      if (PTRe.test(relativePath)) {
        ptDCMFiles.push(decompressedFiles[relativePath].buffer);
      } else if (CTRe.test(relativePath)) {
        ctDCMFiles.push(decompressedFiles[relativePath].buffer);
      }
    }
  });

  let ctImageData = null;
  let ptImageData = null;
  if (window.itk) {
    const { image: ctitkImage, webWorkerPool: ctWebWorkers } =
      await window.itk.readImageDICOMArrayBufferSeries(ctDCMFiles);
    ctWebWorkers.terminateWorkers();
    ctImageData = vtkITKHelper.convertItkToVtkImage(ctitkImage);
    const { image: ptitkImage, webWorkerPool: ptWebWorkers } =
      await window.itk.readImageDICOMArrayBufferSeries(ptDCMFiles);
    ptWebWorkers.terminateWorkers();
    ptImageData = vtkITKHelper.convertItkToVtkImage(ptitkImage);
  }
  return resliceAndSetup(ctImageData, ptImageData);
};

function Example(props) {
  const [statusText, setStatusText] = useState('Loading data, please wait ...');
  const [kSlice, setKSlice] = useState(0);
  const [ptjSlice, setJSlice] = useState(0);
  const [ctjSlice, setCTJSlice] = useState(0);
  const [colorWindow, setColorWindow] = useState(2048);
  const [colorLevel, setColorLevel] = useState(0);
  const [ptcolorWindow, setPTColorWindow] = useState(69222);
  const [ptcolorLevel, setPTColorLevel] = useState(34611);
  const [colorPreset, setColorPreset] = useState('jet');
  const [opacity, setOpacity] = useState(0.4);
  const [maxKSlice, setMaxKSlice] = useState(310);
  const [maxJSlice, setMaxJSlice] = useState(110);
  const [resliced, setResliced] = useState(false);
  const [mapper1] = useState(() => vtkImageMapper.newInstance());
  const [mapper2] = useState(() => vtkImageMapper.newInstance());
  //const [mapper3] = useState(() => vtkImageMapper.newInstance());
  //const [mapper4] = useState(() => vtkImageMapper.newInstance());
  window.setMaxKSlice = setMaxKSlice;
  window.setMaxJSlice = setMaxJSlice;
  window.setStatusText = setStatusText;
  window.setPTColorWindow = setPTColorWindow;
  window.setPTColorLevel = setPTColorLevel;
  window.setResliced = setResliced;

  useEffect(() => {
    if (window.ctData && window.ptData) {
      const ptDim = window.ptData.getDimensions();
      setKSlice(Math.floor(ptDim[2]/2));
      setJSlice(Math.floor(ptDim[1]/2));
      const ctDim = window.ctData.getDimensions();
      setCTJSlice(Math.floor(ctDim[1]/2));
    }
  }, [window.ctData, window.ptData]);

  /*
  useEffect(() =>
    [mapper1, mapper2].forEach((m) => {
    if (m) {
      m.setResolveCoincidentTopology(true);
      m.setResolveCoincidentTopologyToPolygonOffset();
      m.setResolveCoincidentTopologyPolygonOffsetParameters(0, 0);
      console.log('m = ', m.getState());
    }
  }), [mapper1, mapper2]);
  */

  return (
    <MultiViewRoot>
      <input id='fileInput' type='file' className='file' accept='.zip' onChange={loadLocalData}/>
      <input id='exampleInput' type='button' value='Download Example Data' accept='.zip' onClick={loadData}/>
      <ShareDataSetRoot>
        <RegisterDataSet id='ctData'>
          <Dataset dataset={window.ctData} />
        </RegisterDataSet>
        <RegisterDataSet id='ptData'>
          <Dataset dataset={window.ptData} />
        </RegisterDataSet>
        <div
          style={{
            display: 'flex',
            flexFlow: 'row',
            flexWrap: 'wrap',
            width: '100%',
            height: '100%',
          }}
        >
          <label
            style={{
              position: 'absolute',
              zIndex: 100,
              left: '45%',
              top: '65%',
              fontSize: '25px',
            }}
          >
            {statusText}
          </label>
          <Slider
            label='Color Level'
            max={4095}
            value={colorLevel}
            setValue={setColorLevel}
            style={{ top: '60px', left: '5px' }}
          />
          <Slider
            label='Color Window'
            max={4095}
            value={colorWindow}
            setValue={setColorWindow}
            style={{ top: '60px', left: '455px' }}
          />
          <Slider
            label='PET Opacity'
            min={0.0}
            step={0.1}
            max={1.0}
            value={opacity}
            setValue={setOpacity}
            style={{ top: '30px', left: '5px' }}
          />
          <DropDown
            label='Color Preset'
            options={vtkColorMaps.rgbPresetNames}
            value={colorPreset}
            setValue={setColorPreset}
            style={{ top: '10px', left: '405px' }}
          />
          <div className='loader' id='loader' />
          <div
            style={{
              position: 'absolute',
              left: '0px',
              width: '33%',
              height: '100%',
            }}
          >
            <View
              id='axial'
              camera={{
                position: [0, 0, 0],
                focalPoint: [0, 0, 1],
                viewUp: [0, -1, 0],
                parallelProjection: true,
              }}
              background={[0, 0, 0]}
            >
              <Slider
                label='Slice'
                max={maxKSlice}
                value={kSlice}
                setValue={setKSlice}
                orient='vertical'
                style={{ top: '50%', left: '1%' }}
              />
              <SliceRepresentation
                kSlice={kSlice}
                mapperInstance={mapper1}
                /*
                mapper={{
                  resolveCoincidentTopology: 'Polygon',
                  resolveCoincidentTopologyPolygonOffsetParameters: {
                    factor: 0,
                    offset: 2,
                  },
                }}*/
                property={{
                  opacity,
                  colorWindow: ptcolorWindow,
                  colorLevel: ptcolorLevel,
                }}
                colorMapPreset={colorPreset}
                useLookupTableScalarRange={false}
              >
                <UseDataSet id='ptData' />
              </SliceRepresentation>
              <SliceRepresentation
                kSlice={kSlice}
                property={{
                  colorWindow,
                  colorLevel,
                }}
              >
                <UseDataSet id='ctData' />
              </SliceRepresentation>
            </View>
          </div>
          <div
            style={{
              position: 'absolute',
              left: '33%',
              width: '33%',
              height: '100%',
            }}
          >
            <View
              id='coronal'
              camera={{
                position: [0, 0, 0],
                focalPoint: [0, 1, 0],
                viewUp: [0, 0, 1],
                parallelProjection: true,
              }}
              background={[0, 0, 0]}
            >
              <Slider
                label='Slice'
                max={maxJSlice}
                value={ctjSlice}
                setValue={setCTJSlice}
                setPTValue={setJSlice}
                resliced={resliced}
                orient='vertical'
                style={{ top: '50%', left: '5%' }}
              />
              <SliceRepresentation
                jSlice={ptjSlice}
                mapperInstance={mapper2}
                /*
                mapper={{
                  resolveCoincidentTopology: 'Polygon',
                  resolveCoincidentTopologyPolygonOffsetParameters: {
                    factor: 0,
                    offset: 2,
                  },
                }}*/
                property={{
                  opacity,
                  colorWindow: ptcolorWindow,
                  colorLevel: ptcolorLevel,
                }}
                colorMapPreset={colorPreset}
                useLookupTableScalarRange={false}
              >
                <UseDataSet id='ptData' />
              </SliceRepresentation>
              <SliceRepresentation
                jSlice={ctjSlice}
                property={{
                  colorWindow,
                  colorLevel,
                }}
              >
                <UseDataSet id='ctData' />
              </SliceRepresentation>
            </View>
          </div>
          <div
            style={{
              position: 'absolute',
              left: '66%',
              width: '33%',
              height: '100%',
            }}
          >
            <View
              id='mip3D'
              camera={{
                position: [0, 0, 0],
                focalPoint: [0, 1, 0],
                viewUp: [0, 0, 1],
                parallelProjection: true,
              }}
              background={[0, 0, 0]}
            >
              <VolumeRepresentation
                mapper={{
                  blendMode: BlendMode.MAXIMUM_INTENSITY_BLEND,
                  maximumSamplesPerRay: 2000,
                }}
                colorMapPreset='Grayscale'
                useLookupTableScalarRange={false}
                shade={false}
              >
                <UseDataSet id='ptData' />
              </VolumeRepresentation>
            </View>
          </div>
        </div>
      </ShareDataSetRoot>
    </MultiViewRoot>
  );
}

export default Example;
