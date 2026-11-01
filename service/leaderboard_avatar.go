package service

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"

	imagedraw "golang.org/x/image/draw"
)

const MaxLeaderboardAvatarBytes = 2 << 20

// NormalizeLeaderboardAvatar bounds decoding work and strips metadata by
// rendering uploads to a small JPEG, safe to store in TEXT on all databases.
func NormalizeLeaderboardAvatar(data []byte) (string, error) {
	if len(data) == 0 || len(data) > MaxLeaderboardAvatarBytes {
		return "", errors.New("头像图片不能超过 2 MB")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") {
		return "", errors.New("请上传有效的 PNG 或 JPEG 图片")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 4_000_000 {
		return "", errors.New("头像图片尺寸不能超过 400 万像素或单边 4096 像素")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", errors.New("无法读取头像图片")
	}
	bounds := source.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	left, top := bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2
	target := image.NewRGBA(image.Rect(0, 0, 128, 128))
	draw.Draw(target, target.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	imagedraw.CatmullRom.Scale(target, target.Bounds(), source, image.Rect(left, top, left+side, top+side), draw.Over, nil)
	var output bytes.Buffer
	if err := jpeg.Encode(&output, target, &jpeg.Options{Quality: 85}); err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(output.Bytes()), nil
}
