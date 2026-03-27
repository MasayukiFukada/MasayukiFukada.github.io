# [Main Page](https://masayukifukada.github.io/)

## Deploy local machine

1. exec `run_server.sh`

## PWA について

- アイコン画像の丸型切り抜きは Imagemagik を使用する( オンラインの野良サービスは透過できなかったり、サイズが異なる )
    - convert input.jpg -resize 512x512^ -gravity center -extent 512x512 \( -size 512x512 xc:none -fill white -draw "circle 256,256 256,0" \) l-alpha off -compose CopyOpacity -composite output.png
