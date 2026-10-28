package ratio_setting

import "sync"

// Personal ratios are persisted separately from administrator options so a
// settings save or a scheduled option update cannot overwrite an owner's price.
var personalRatios = struct {
	sync.RWMutex
	values map[string]float64
}{values: make(map[string]float64)}

func SetPersonalGroupRatios(values map[string]float64) {
	copy := make(map[string]float64, len(values))
	for name, ratio := range values {
		copy[name] = ratio
	}
	personalRatios.Lock()
	personalRatios.values = copy
	personalRatios.Unlock()
}

func PersonalGroupRatio(name string) (float64, bool) {
	personalRatios.RLock()
	defer personalRatios.RUnlock()
	ratio, ok := personalRatios.values[name]
	return ratio, ok
}

func HasPersonalGroups() bool {
	personalRatios.RLock()
	defer personalRatios.RUnlock()
	return len(personalRatios.values) > 0
}
