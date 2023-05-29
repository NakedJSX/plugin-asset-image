import querystring from 'node:querystring';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';

let log;

const plugin =
    {
        type: 'asset',
        importAsset: importAssetImage
    };

export default function(context)
{
    log = context.logging.log;

    context.register(plugin);
}

async function importAssetImage(context, asset)
{
    const options =
        {
            // TODO: support and default to 'auto', png if source is png else jpeg
            fallback:       'jpeg',
            webp:           true,
            // densityBasis:   'height',// TODO - support width basis
            displayWidth:   0,          // width in destination page px, 0 to calculate based on source and srcDensity
            displayHeight:  0,          // height as above
            srcDensity:     2,
            dstDensity:
                [
                    // For unscaled desktop resolutions:
                    1,      // 100%
                    // 1.1,    // 110%
                    // 1.25,   // 125%
                    // 1.5,    // 150%
                    // 1.75,   // 175%
                    
                    // For scaled desktop resolutions: (to support all of these, srcDensity needs >= 3)
                    2,      // 200%
                    // 2.2,    // 110%
                    // 2.5,    // 125%
                    // 3,      // 150%
                ],
            
            //
            // Override the defaults via import query string
            // e.g. import image from 'some_image.jpeg?image:srcDensity=1
            //

            ...querystring.decode(asset.optionsString)
        };

    for (let [key, value]  of Object.entries(options))
    {
        if (value === '')
            options[key] = true;
        else if (value === 'false')
            options[key] = false;
    }

    const acceptedDensities = [];
    options.srcDensity      = Number.parseFloat(options.srcDensity);

    for (let dstDensity of options.dstDensity)
    {
        dstDensity = Number.parseFloat(dstDensity);

        if (dstDensity <= 0)
            throw Error(`invalid dstDensity ${dstDensity} for ${asset.id}`);
        
        if (dstDensity <= options.srcDensity)
            acceptedDensities.push(dstDensity);

        //
        // For now, silently ignore requested dst densities higher than the source.
        // Given that the default is to produce both a 1x and a 2x, any use of 1x 
        // assets would give a lot of warnings and it wouldn't be fun to have to add
        // &dstDensity=[1] to every 1x asset import.
        //

        // else
        //     warn(`Ignoring invalid dstDensity ${dstDensity} for ${asset.id} (can't be larger than the srcDensity of ${options.srcDensity})`);
    }

    if (!acceptedDensities.length)
        throw new Error(`No accepted dstDensity for ${asset.id}`);

    options.dstDensity = acceptedDensities.sort();

    async function gm(...args)
    {
        return new Promise(
            (resolve, reject) =>
            {
                log('gm ' + args.join(' '));

                let output = '';

                const subprocess = spawn('gm', args, { stdio: ['ignore', 'pipe', 'inherit'] });
                subprocess.stdout.on('data', data => output += data);
                subprocess.on(
                    'close',
                    code =>
                    {
                        if (code)
                            reject(new Error(`gm failed with exit code ${code}, command was:\n  gm ${args.join(' ')}\n`));
                        else
                            resolve(output);
                    });
            });
    }

    //
    // Identify the type and size of original image file
    //

    const identifyOutput = await gm('identify', '-format', '%m %w %h', asset.file);
    let [ , originalType, originalWidth, originalHeight ] = identifyOutput.match(/([A-Za-z]+) (\d+) (\d+)/);

    originalWidth   = Number.parseInt(originalWidth);
    originalHeight  = Number.parseInt(originalHeight);

    if (originalWidth < 1 || originalHeight < 1)
        throw new Error(`bad original image size ${originalWidth}x${originalHeight} for ${asset.id}`);

    //
    // Create destination images in each requested density
    //

    const tmpDir            = await context.mkdtemp();
    const parsedFilepath    = path.parse(asset.file);
    const webpSrcSet        = [];
    const jpegSrcSet        = [];

    let defaultSrc;
    
    // The following code relies on sorted densities.
    options.dstDensity      = options.dstDensity.sort()
    
    // After the loop, this will point to the largest density
    let dstDensity;
    for (dstDensity of options.dstDensity)
    {
        const outWidth      = Math.ceil(originalWidth / options.srcDensity * dstDensity);
        const dstDensityStr = dstDensity.toFixed(3).replace(/\.?0+$/, '') + 'x';

        if (options.webp)
        {
            const outFilename   = `${parsedFilepath.name}-${dstDensityStr}.webp`;
            const outFilepath   = `${tmpDir}/${outFilename}`;
            
            await gm('convert', asset.file, '-resize', `${outWidth}x!`, '-quality', '85', '-define', 'webp:method=6', outFilepath);

            const hashFilename  = await context.hashAndOutputAsset(outFilepath);
            const outUripath    = await context.assetUriPath(hashFilename);

            webpSrcSet.push(`${outUripath} ${dstDensityStr}`);
            defaultSrc = outUripath;
        }

        if (options.fallback == 'jpeg')
        {
            const outFilename   = `${parsedFilepath.name}-${dstDensityStr}.jpeg`;
            const outFilepath   = `${tmpDir}/${outFilename}`;

            await gm('convert', asset.file, '-resize', `${outWidth}x!`, '-quality', '85', outFilepath);

            const hashFilename  = await context.hashAndOutputAsset(outFilepath);
            const outUripath    = await context.assetUriPath(hashFilename);

            jpegSrcSet.push(`${outUripath} ${dstDensityStr}`);
            defaultSrc = outUripath;
        }
    }

    await fsp.rmdir(tmpDir);

    const displayWidth  = options.displayWidth  || Math.ceil(originalWidth  / options.srcDensity);
    const displayHeight = options.displayHeight || Math.ceil(originalHeight / options.srcDensity);

    const resultData =
        {
            webpSrcSet:     webpSrcSet.join(', '),
            jpegSrcSet:     jpegSrcSet.join(', '),
            css:            `width: ${displayWidth}px; height: ${displayHeight}px`,
            displayWidth,
            displayHeight,
            defaultSrc
        };
    
    //
    // We're finished creating the data for imports
    //

    return `export default ${JSON.stringify(resultData)}`;
}