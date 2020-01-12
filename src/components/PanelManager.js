/*
 * Copyright (c) 2019 ARTIC Network http://artic.network
 * https://github.com/artic-network/rampart
 *
 * This file is part of RAMPART. RAMPART is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. RAMPART is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License
 * along with RAMPART. If not, see <http://www.gnu.org/licenses/>.
 *
 */

import React, { useState, useRef } from 'react';
// import PropTypes from "prop-types";
import SamplePanel from "./SamplePanel"
import OverallSummaryPanel from "./OverallSummaryPanel";
import { isEqual } from "lodash";

const PanelManager = ({dataPerSample, combinedData, viewOptions, config, openConfigSidebar, socket, timeSinceLastDataUpdate}) => {
    
    /* -----------    STATE MANAGEMENT    ------------------- */
    const [samplePanelsExpanded, setSamplePanelsExpanded] = useState({});
    const refs = useRef(new Map());
    const setPanelExpanded = (panelName, newState) => {
        const state = {...samplePanelsExpanded};
        state[panelName] = newState;
        setSamplePanelsExpanded(state);
    }
    const goToSamplePanel = (panelName) => {
        if (!samplePanelsExpanded[panelName]) setPanelExpanded(panelName, true);
        window.scrollTo({left: 0, top: refs.current.get(panelName).current.offsetTop, behavior: "smooth"});
    }

    /* If we have new panels (e.g. new sampleNames / barcodes discovered or defined) then set `samplePanelsExpanded`
     * An alternative approach would be to use `useEffect` here.
     */ 
    if (!isEqual(Object.keys(samplePanelsExpanded), Object.keys(dataPerSample))) {
        const state = {};
        Object.keys(dataPerSample).forEach((sampleName) => {
            state[sampleName] = true; // set to false to start with collapsed panels
            if (!refs.current.has(sampleName)) refs.current.set(sampleName, {current: null});
        });
        setSamplePanelsExpanded(state);
    }

    if (!dataPerSample || !combinedData) {
        return (
            <h1>????</h1>
        );
    }

    /* ----------------- R E N D E R ---------------- */
    return (
        <>
            <OverallSummaryPanel
                viewOptions={viewOptions}
                combinedData={combinedData}
                dataPerSample={dataPerSample}
                key={"overall"}
                config={config}
                goToSamplePanel={goToSamplePanel}
            />
            {Object.keys(dataPerSample).map((name) => (
                <div key={name} ref={refs.current.get(name)}>
                    <SamplePanel
                        sampleName={name}
                        sampleData={dataPerSample[name]}
                        sampleColour={viewOptions.sampleColours[name]}
                        panelExpanded={samplePanelsExpanded[name]}
                        setPanelExpanded={setPanelExpanded}
                        viewOptions={viewOptions}
                        reference={config.reference}
                        socket={socket}
                        config={config}
                        timeSinceLastDataUpdate={timeSinceLastDataUpdate}
                    />
                </div>
            ))}
        </>
    )
}


export default PanelManager;