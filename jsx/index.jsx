export const Image =
    props =>
    {
        //
        // Allow this JSX to be used like an <img src='...'> tag
        //

        if (typeof props.src === 'string')
            return <img {...props} />;
        
        //
        // Hopefully we have an ':image:' based asset import, which contains
        // metadata about the assets exported by the NakedJSX build process.
        //

        const asset = props.src;
        props.src = asset.defaultSrc;

        return  <picture>
                    {/* Modern formats */}
                    {asset.webpSrcSet ?
                        <source srcset={asset.webpSrcSet} type="image/webp" sizes={asset.displayWidth + 'px'} /> : false}

                    {/* Fallback formats for which we have generated a source set */}
                    {asset.jpegSrcSet
                        ? <img css={asset.css} srcset={asset.jpegSrcSet} sizes={asset.displayWidth + 'px'} {...props} />
                        : asset.pngSrcSet
                            ? <img css={asset.css} srcset={asset.pngSrcSet} sizes={asset.displayWidth + 'px'} {...props} />
                            : false}

                    {/* If we don't have a fallback format source set, then it's just an image for which we have generated width&height css */}
                    {!asset.jpegSrcSet && !asset.pngSrcSet ?
                        <img css={asset.css} {...props} /> : false}
                </picture>;
    }
